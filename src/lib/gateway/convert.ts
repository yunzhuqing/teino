import type { ApiType } from "../db/schema";
import type { IrRequest, IrResponse, IrStreamEvent, IrUsage, Obj } from "./ir";
import { CODECS, extractErrorMessage, type EncodeContext } from "./protocol";
import { parseSseStream, serializeSse } from "./sse";
import { errorBody } from "./upstream";

/**
 * 协议转换编排：客户端协议 ⇄ IR ⇄ 上游协议。
 * 仅在两端协议不同时调用；同协议请求由 handler 直接透传。
 */

/** 解析客户端请求为 IR；不支持的字段抛 UnsupportedFieldError */
export function parseClientRequest(apiType: ApiType, body: Obj): IrRequest {
  return CODECS[apiType].parseRequest(body);
}

/** 由 IR 构建发往上游的请求体；Anthropic 要求 max_tokens 必填，缺省时用兜底值 */
export function buildUpstreamRequest(apiType: ApiType, ir: IrRequest, upstreamModel: string, defaultMaxTokens: number): Obj {
  const withMax = apiType === "anthropic_messages" && ir.maxTokens === undefined ? { ...ir, maxTokens: defaultMaxTokens } : ir;
  return CODECS[apiType].buildRequest(withMax, upstreamModel);
}

/** 推理内容跨协议无法搬运（签名 / 加密），统一丢弃 */
function stripReasoning(ir: IrResponse): IrResponse {
  return { ...ir, content: ir.content.filter((p) => p.type !== "reasoning") };
}

export function convertResponse(upstream: ApiType, client: ApiType, body: unknown, ctx: EncodeContext): Obj {
  return CODECS[client].buildResponse(stripReasoning(CODECS[upstream].parseResponse(body)), ctx);
}

/** 丢弃推理块并把剩余块的 index 重排为连续值 */
export async function* dropReasoningEvents(events: AsyncIterable<IrStreamEvent>): AsyncGenerator<IrStreamEvent> {
  const remap = new Map<number, number>();
  const dropped = new Set<number>();
  for await (const ev of events) {
    switch (ev.type) {
      case "block_start":
        if (ev.part.type === "reasoning") dropped.add(ev.index);
        else {
          remap.set(ev.index, remap.size);
          yield { ...ev, index: remap.size - 1 };
        }
        break;
      case "text_delta":
      case "json_delta":
      case "reasoning_delta":
      case "block_stop": {
        if (dropped.has(ev.index) || ev.type === "reasoning_delta") break;
        const index = remap.get(ev.index);
        if (index !== undefined) yield { ...ev, index };
        break;
      }
      default:
        yield ev;
    }
  }
}

async function* tapUsage(events: AsyncIterable<IrStreamEvent>, usage: IrUsage): AsyncGenerator<IrStreamEvent> {
  for await (const ev of events) {
    if ((ev.type === "message_start" || ev.type === "message_delta") && ev.usage) {
      if (ev.usage.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
      if (ev.usage.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
    }
    yield ev;
  }
}

/** 上游 SSE 字节流 → 客户端协议 SSE 字节流；done 在流结束 / 出错 / 取消时 resolve usage */
export function convertStream(
  upstream: ApiType,
  client: ApiType,
  body: ReadableStream<Uint8Array>,
  ctx: EncodeContext,
): { stream: ReadableStream<Uint8Array>; done: Promise<{ usage: IrUsage; error?: string }> } {
  const usage: IrUsage = {};
  const target = CODECS[client];
  let resolve!: (v: { usage: IrUsage; error?: string }) => void;
  const done = new Promise<{ usage: IrUsage; error?: string }>((r) => (resolve = r));
  let streamError: string | undefined;

  async function* pipeline() {
    const ir = tapUsage(dropReasoningEvents(CODECS[upstream].decodeStream(parseSseStream(body))), usage);
    try {
      yield* target.encodeStream(ir, ctx);
    } catch (err) {
      streamError = err instanceof Error ? err.message : String(err);
      yield* target.streamError(streamError);
    }
  }

  const stream = serializeSse(pipeline(), (err) => {
    const error = streamError ?? (err === undefined ? undefined : err instanceof Error ? err.message : String(err));
    resolve({ usage, error });
  });
  return { stream, done };
}

/** 上游错误体改写为客户端协议的错误信封，避免协议形状泄漏 */
export function convertErrorBody(client: ApiType, status: number, text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const message = extractErrorMessage(parsed) ?? (text.slice(0, 500) || `上游返回 HTTP ${status}`);
  return errorBody(client, status, message);
}
