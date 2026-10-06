import "server-only";
import { after } from "next/server";
import { BILLING_ENABLED, estimateCredits, settleRequest, type BillingTarget } from "../billing/settle";
import { estimateInputTokens, estimateOutputTokens } from "../billing/estimate";
import { parseCredit } from "../billing/money";
import { selectPeriod } from "../billing/pricing";
import { sha256 } from "../crypto";
import type { ApiType } from "../db/schema";
import { buildUpstreamRequest, convertErrorBody, convertResponse, convertStream, parseClientRequest } from "./convert";
import { callUpstream, errorResponse, extractKey, parseJsonObject, pickHeaders } from "./http";
import type { IrRequest } from "./ir";
import { writeLog, type LogEntry } from "./logs";
import { loadRoutingContext, type CandidateWithSecret } from "./repository";
import { planRoute, upstreamApiType } from "./routing";
import { isRetryableStatus, mergeUsage, tapSseUsage, type Usage } from "./upstream";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.GATEWAY_MAX_ATTEMPTS) || 3);
const DEFAULT_MAX_TOKENS = Math.max(1, Number(process.env.GATEWAY_DEFAULT_MAX_TOKENS) || 4096);
const TAG_HEADER = "x-gateway-tags";
/** 请求声明的优先级档位，用于查模型的价格倍率；不同协议字段名不同 */
const PRIORITY_FIELDS = ["service_tier", "priority", "x-gateway-priority"];

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 从请求体或请求头里取请求声明的优先级档位 */
function readPriorityTier(req: Request, body: Record<string, unknown>): string | null {
  for (const f of PRIORITY_FIELDS) {
    const v = body[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const header = req.headers.get("x-gateway-priority");
  return header?.trim() || null;
}

/** 从路由候选里取出计费需要的字段 */
function billingTarget(target: CandidateWithSecret): BillingTarget {
  return {
    modelId: target.modelId,
    modelName: target.modelName,
    billingMode: target.billingMode,
    currency: target.currency,
    priorityMultipliers: target.priorityMultipliers,
    prices: target.prices,
  };
}

export async function handleGatewayRequest(req: Request, apiType: ApiType): Promise<Response> {
  const started = Date.now();
  const key = extractKey(req);
  if (!key) return errorResponse(apiType, 401, "缺少 API Key（Authorization: Bearer 或 x-api-key）");

  const body = await parseJsonObject(req);
  if (!body) return errorResponse(apiType, 400, "请求体必须为 JSON 对象");
  const model = typeof body.model === "string" ? body.model : "";
  if (!model) return errorResponse(apiType, 400, "缺少 model 字段");

  const requiredTagNames = (req.headers.get(TAG_HEADER) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { callerResult, candidates, requiredTagIds, periods, currencies } = await loadRoutingContext(sha256(key), model, requiredTagNames);
  if (!callerResult.ok) return errorResponse(apiType, 401, callerResult.reason);
  const { caller } = callerResult;
  const priorityTier = readPriorityTier(req, body);

  let plan = planRoute(candidates, { model, apiType, callerTagIds: caller.tagIds, requiredTagIds });

  const log: LogEntry = {
    apiKeyId: caller.apiKeyId,
    userId: caller.userId,
    providerId: null,
    modelId: null,
    apiType,
    upstreamApiType: null,
    model,
    stream: body.stream === true,
    status: 0,
    attempts: 0,
    latencyMs: 0,
  };
  const errors: string[] = [];
  /** 记录本次实际命中的上游，结算时按它的价格计费（可能是故障转移后的那个） */
  let chargedTarget: CandidateWithSecret | null = null;

  const finish = async (status: number, usage: Usage = {}) => {
    const requestLogId = await writeLog({ ...log, ...usage, status, latencyMs: Date.now() - started, error: errors.join("\n") || undefined });
    // 只有成功转发到某个上游的请求才计费：4xx/5xx 没有被服务，不应扣费
    if (!chargedTarget || status >= 400) return;
    await settleRequest({
      apiKeyId: caller.apiKeyId,
      userId: caller.userId,
      requestLogId,
      target: billingTarget(chargedTarget),
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      priorityTier,
      periods,
      currencies,
    });
  };

  // 需要协议转换时只解析一次请求；无法转换则剔除需要转换的上游，只剩同协议上游可用
  let ir: IrRequest | null = null;
  let requestError: string | null = null;
  if (plan.some((t) => upstreamApiType(t, apiType) !== apiType)) {
    try {
      ir = parseClientRequest(apiType, body);
    } catch (err) {
      requestError = errMsg(err);
      plan = plan.filter((t) => upstreamApiType(t, apiType) === apiType);
    }
  }
  plan = plan.slice(0, MAX_ATTEMPTS);

  if (plan.length === 0) {
    const status = requestError ? 400 : 404;
    errors.push(requestError ?? `没有可用于模型 "${model}" 的上游（请检查模型、供应商 API 类型与标签路由）`);
    after(() => finish(status));
    return errorResponse(apiType, status, errors[0]);
  }

  // 余额预检：按最可能的落点估算成本，不足则直接拒绝，不转发到上游
  if (BILLING_ENABLED) {
    const target = plan[0];
    const period = selectPeriod(periods, new Date());
    const estimated = estimateCredits({
      target: billingTarget(target),
      inputTokens: estimateInputTokens(body),
      outputTokens: estimateOutputTokens(body, target.defaultMaxTokens ?? DEFAULT_MAX_TOKENS),
      priorityTier,
      period,
      currencies,
    });
    const balance = parseCredit(caller.creditBalance);
    // 估算失败（没有匹配价位/汇率）时不拦截，交给结算阶段记录告警
    if (estimated !== null && (balance <= 0n || balance - estimated < 0n)) {
      errors.push(`积分余额不足：当前 ${caller.creditBalance}，本次预计消耗 ${estimated}`);
      after(() => finish(402));
      return errorResponse(apiType, 402, "积分余额不足", { "x-gateway-balance": caller.creditBalance });
    }
  }

  let lastFailure: { status: number; text: string; headers: Headers } | null = null;
  const ctx = { model, request: body };

  for (const target of plan) {
    const upstream = upstreamApiType(target, apiType);
    const converting = upstream !== apiType;

    let upstreamBody: Record<string, unknown>;
    if (converting) {
      try {
        upstreamBody = buildUpstreamRequest(upstream, ir!, target.upstreamModel, target.defaultMaxTokens ?? DEFAULT_MAX_TOKENS);
      } catch (err) {
        // 该上游协议无法表达此请求（如 Responses 不支持停止词），换下一个
        requestError = errMsg(err);
        errors.push(`${target.provider.name}: ${requestError}`);
        continue;
      }
    } else {
      upstreamBody = { ...body, model: target.upstreamModel };
    }

    log.attempts++;
    log.providerId = target.provider.id;
    log.modelId = target.modelId;
    log.upstreamApiType = converting ? upstream : null;

    let res: Response;
    try {
      res = await callUpstream(req, upstream, target, upstreamBody);
    } catch (err) {
      errors.push(`${target.provider.name}: ${errMsg(err)}`);
      if (req.signal.aborted) break;
      continue;
    }

    // 可重试错误（429 / 5xx 等）：故障转移到下一个上游
    if (!res.ok && isRetryableStatus(res.status)) {
      const text = await res.text().catch(() => "");
      errors.push(`${target.provider.name}: HTTP ${res.status} ${text.slice(0, 300)}`);
      lastFailure = converting
        ? { status: res.status, text: convertErrorBody(apiType, res.status, text), headers: new Headers({ "content-type": "application/json" }) }
        : { status: res.status, text, headers: pickHeaders(res.headers) };
      continue;
    }

    const status = res.status;
    const headers = pickHeaders(res.headers);
    headers.set("x-gateway-provider", encodeURIComponent(target.provider.name));
    headers.set("x-gateway-attempts", String(log.attempts));
    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
    // 已确定由这个上游服务本次请求，结算按它的价格
    chargedTarget = target;

    if (!converting) {
      if (isSse && res.body) {
        const { stream, done } = tapSseUsage(res.body);
        after(async () => finish(status, await done));
        return new Response(stream, { status, headers });
      }
      const text = await res.text();
      const usage: Usage = {};
      try {
        mergeUsage(usage, JSON.parse(text));
      } catch {
        // 非 JSON 响应
      }
      if (!res.ok) errors.push(`${target.provider.name}: HTTP ${status} ${text.slice(0, 300)}`);
      after(() => finish(status, usage));
      return new Response(text, { status, headers });
    }

    // ---- 跨协议：响应从上游协议转换回请求协议 ----
    headers.set("x-gateway-upstream-api", upstream);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      errors.push(`${target.provider.name}: HTTP ${status} ${text.slice(0, 300)}`);
      headers.set("content-type", "application/json");
      after(() => finish(status));
      return new Response(convertErrorBody(apiType, status, text), { status, headers });
    }

    if (isSse && res.body) {
      const { stream, done } = convertStream(upstream, apiType, res.body, ctx);
      headers.set("content-type", "text/event-stream; charset=utf-8");
      headers.set("cache-control", "no-cache");
      after(async () => {
        const r = await done;
        if (r.error) errors.push(`${target.provider.name}: 流式转换中断：${r.error}`);
        await finish(status, r.usage);
      });
      return new Response(stream, { status, headers });
    }

    const text = await res.text();
    try {
      const parsed: unknown = JSON.parse(text);
      const usage: Usage = {};
      mergeUsage(usage, parsed);
      const converted = convertResponse(upstream, apiType, parsed, ctx);
      headers.set("content-type", "application/json");
      after(() => finish(status, usage));
      return new Response(JSON.stringify(converted), { status, headers });
    } catch (err) {
      errors.push(`${target.provider.name}: 响应转换失败：${errMsg(err)} ${text.slice(0, 300)}`);
      after(() => finish(502));
      return errorResponse(apiType, 502, `上游响应无法转换为请求协议：${errMsg(err)}`, Object.fromEntries(headers));
    }
  }

  // 所有上游都因请求无法转换被跳过：属于调用方问题
  if (log.attempts === 0 && requestError) {
    after(() => finish(400));
    return errorResponse(apiType, 400, requestError);
  }

  const status = lastFailure?.status ?? 502;
  after(() => finish(status));
  if (lastFailure) {
    lastFailure.headers.set("x-gateway-attempts", String(log.attempts));
    return new Response(lastFailure.text, { status, headers: lastFailure.headers });
  }
  return errorResponse(apiType, 502, `所有上游均失败：${errors.join(" | ")}`, {
    "x-gateway-attempts": String(log.attempts),
  });
}
