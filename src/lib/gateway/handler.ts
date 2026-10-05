import "server-only";
import { after } from "next/server";
import { sha256 } from "../crypto";
import type { ApiType } from "../db/schema";
import { callUpstream, errorResponse, extractKey, parseJsonObject, pickHeaders } from "./http";
import { writeLog, type LogEntry } from "./logs";
import { loadRoutingContext } from "./repository";
import { planRoute } from "./routing";
import { isRetryableStatus, mergeUsage, tapSseUsage, type Usage } from "./upstream";

const MAX_ATTEMPTS = Math.max(1, Number(process.env.GATEWAY_MAX_ATTEMPTS) || 3);
const TAG_HEADER = "x-gateway-tags";

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

  const { callerResult, candidates, requiredTagIds } = await loadRoutingContext(sha256(key), model, requiredTagNames);
  if (!callerResult.ok) return errorResponse(apiType, 401, callerResult.reason);
  const { caller } = callerResult;

  const plan = planRoute(candidates, { model, apiType, callerTagIds: caller.tagIds, requiredTagIds }).slice(
    0,
    MAX_ATTEMPTS,
  );

  const log: LogEntry = {
    apiKeyId: caller.apiKeyId,
    userId: caller.userId,
    providerId: null,
    modelId: null,
    apiType,
    model,
    stream: body.stream === true,
    status: 0,
    attempts: 0,
    latencyMs: 0,
  };
  const errors: string[] = [];
  const finish = (status: number, usage: Usage = {}) =>
    writeLog({ ...log, ...usage, status, latencyMs: Date.now() - started, error: errors.join("\n") || undefined });

  if (plan.length === 0) {
    errors.push(`没有可用于模型 "${model}" 的上游（请检查模型、供应商 API 类型与标签路由）`);
    after(() => finish(404));
    return errorResponse(apiType, 404, errors[0]);
  }

  let lastFailure: { status: number; text: string; headers: Headers } | null = null;

  for (const target of plan) {
    log.attempts++;
    log.providerId = target.provider.id;
    log.modelId = target.modelId;

    let res: Response;
    try {
      res = await callUpstream(req, apiType, target, body);
    } catch (err) {
      errors.push(`${target.provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      if (req.signal.aborted) break;
      continue;
    }

    // 可重试错误（429 / 5xx 等）：故障转移到下一个上游
    if (!res.ok && isRetryableStatus(res.status)) {
      const text = await res.text().catch(() => "");
      errors.push(`${target.provider.name}: HTTP ${res.status} ${text.slice(0, 300)}`);
      lastFailure = { status: res.status, text, headers: pickHeaders(res.headers) };
      continue;
    }

    const status = res.status;
    const headers = pickHeaders(res.headers);
    headers.set("x-gateway-provider", encodeURIComponent(target.provider.name));
    headers.set("x-gateway-attempts", String(log.attempts));

    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
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
