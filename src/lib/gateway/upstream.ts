import type { ApiType } from "../db/schema";

export const API_TYPE_LABELS: Record<ApiType, string> = {
  openai_chat: "Chat Completions",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
};

const PATHS: Record<ApiType, string> = {
  openai_chat: "/chat/completions",
  openai_responses: "/responses",
  anthropic_messages: "/messages",
};

/** baseUrl 形如 https://api.openai.com/v1 或 https://api.anthropic.com/v1 */
export function buildUpstreamUrl(baseUrl: string, apiType: ApiType): string {
  return baseUrl.replace(/\/+$/, "") + PATHS[apiType];
}

const PASSTHROUGH_HEADERS = ["anthropic-version", "anthropic-beta", "openai-beta", "accept"];

export function buildUpstreamHeaders(
  apiType: ApiType,
  apiKey: string,
  incoming: Headers,
  extra: Record<string, string>,
): Headers {
  const h = new Headers({ "content-type": "application/json" });
  for (const name of PASSTHROUGH_HEADERS) {
    const v = incoming.get(name);
    if (v) h.set(name, v);
  }
  if (apiType === "anthropic_messages") {
    h.set("x-api-key", apiKey);
    if (!h.has("anthropic-version")) h.set("anthropic-version", "2023-06-01");
  } else {
    h.set("authorization", `Bearer ${apiKey}`);
  }
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

export interface Usage {
  /** 未命中缓存的新增输入 token（各协议已归一化：命中/写入缓存的部分不在这里） */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Anthropic 的 cache_creation_input_tokens 可能是数字，也可能是按 TTL 分层的对象 */
function cacheCreation(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (!v || typeof v !== "object") return undefined;
  let total = 0;
  let found = false;
  for (const n of Object.values(v as Record<string, unknown>)) {
    if (typeof n === "number" && Number.isFinite(n)) {
      total += n;
      found = true;
    }
  }
  return found ? total : undefined;
}

/**
 * 从任一种协议的响应对象 / SSE 事件中提取 usage，合并到 acc。
 *
 * 输入 token 的口径差异在这里抹平：
 * - Anthropic 的 input_tokens 不含缓存，cache_read / cache_creation 各自独立
 * - OpenAI 的 prompt_tokens / input_tokens **包含**命中缓存，需减去 cached_tokens
 *
 * 缓存字段采用「一旦拿到就锁定」的规则（与 inputTokens 的「>0 才覆盖」不同）：
 * 上游常在同一响应里重复上报 usage，某一帧把 cached_tokens 报成 0 时若直接覆盖，会丢掉真实值。
 */
export function mergeUsage(acc: Usage, obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  const o = obj as Record<string, unknown>;
  const candidates = [
    o.usage,
    (o.response as Record<string, unknown> | undefined)?.usage, // responses: response.completed
    (o.message as Record<string, unknown> | undefined)?.usage, // anthropic: message_start
  ];
  for (const u of candidates) {
    if (!u || typeof u !== "object") continue;
    const r = u as Record<string, unknown>;
    const details = r.prompt_tokens_details ?? r.input_tokens_details;
    const cached = num(r.cache_read_input_tokens) ?? (details && typeof details === "object" ? num((details as Record<string, unknown>).cached_tokens) : undefined);
    const rawInput = num(r.prompt_tokens) ?? num(r.input_tokens);
    // OpenAI 口径的输入总量包含缓存命中，OpenAI 系协议才会带 details
    const inputIncludesCache = details !== undefined;
    const input = rawInput === undefined ? undefined : inputIncludesCache ? Math.max(0, rawInput - (cached ?? 0)) : rawInput;

    if (input !== undefined && input > 0) acc.inputTokens = input;
    else if (input !== undefined && acc.inputTokens === undefined) acc.inputTokens = input;
    const output = num(r.completion_tokens) ?? num(r.output_tokens);
    if (output !== undefined) acc.outputTokens = output;

    if (cached !== undefined && acc.cacheReadTokens === undefined) acc.cacheReadTokens = cached;
    const write = cacheCreation(r.cache_creation_input_tokens);
    if (write !== undefined && acc.cacheWriteTokens === undefined) acc.cacheWriteTokens = write;
  }
}

/**
 * 透传 SSE 流，同时旁路解析 usage。
 * 返回新的流以及在流结束（或中断）时 resolve 的 usage。
 */
export function tapSseUsage(body: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  done: Promise<Usage>;
} {
  const usage: Usage = {};
  const decoder = new TextDecoder();
  let buffer = "";
  let resolve!: (u: Usage) => void;
  const done = new Promise<Usage>((r) => (resolve = r));

  const handleLine = (line: string) => {
    if (!line.startsWith("data:") || !line.includes("usage")) return;
    try {
      mergeUsage(usage, JSON.parse(line.slice(5).trim()));
    } catch {
      // 非 JSON 行忽略
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const l of lines) handleLine(l.trimEnd());
    },
    flush() {
      handleLine(buffer.trimEnd());
      resolve(usage);
    },
  });

  const stream = body.pipeThrough(transform);
  const reader = stream.getReader();
  // 客户端中断时 flush 不会触发，兜底保证 done 不会永久挂起
  const guarded = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        resolve(usage);
      }
    },
    cancel(reason) {
      resolve(usage);
      // 只能取消 reader：stream 已被它锁定，直接调 stream.cancel 会抛 ERR_INVALID_STATE
      return reader.cancel(reason).catch(() => {});
    },
  });
  return { stream: guarded, done };
}

export function errorBody(apiType: ApiType, status: number, message: string): string {
  if (apiType === "anthropic_messages") {
    const type =
      status === 401 ? "authentication_error" : status === 404 ? "not_found_error" : status === 429 ? "rate_limit_error" : status >= 500 ? "api_error" : "invalid_request_error";
    return JSON.stringify({ type: "error", error: { type, message } });
  }
  const type = status === 401 ? "invalid_api_key" : status >= 500 ? "server_error" : "invalid_request_error";
  return JSON.stringify({ error: { message, type, code: status } });
}

/** 是否应该切换到下一个上游重试 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
