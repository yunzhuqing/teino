import {
  asArray,
  genId,
  InvalidRequestError,
  isObj,
  mergeAdjacent,
  num,
  present,
  str,
  UnsupportedFieldError,
  type IrImageSource,
  type IrMessage,
  type IrPart,
  type IrRequest,
  type IrResponse,
  type IrStopReason,
  type IrStreamEvent,
  type IrToolChoice,
  type IrUsage,
  type Obj,
} from "../ir";
import type { SseEvent } from "../sse";
import { parseJson, sse, UpstreamStreamError, type Codec, type EncodeContext } from "./shared";

/** 无法映射到 IR、会改变输出语义的字段 */
const UNSUPPORTED = ["top_k", "container", "mcp_servers"];

function parseImageSource(src: unknown): IrImageSource {
  if (!isObj(src)) throw new InvalidRequestError("image.source 缺失");
  if (src.type === "base64") return { type: "base64", mediaType: str(src.media_type) ?? "image/png", data: str(src.data) ?? "" };
  if (src.type === "url") return { type: "url", url: str(src.url) ?? "" };
  throw new UnsupportedFieldError(`image.source.type=${String(src.type)}`);
}

function parseBlocks(content: unknown, where: string): IrPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const out: IrPart[] = [];
  for (const b of asArray(content)) {
    if (!isObj(b)) continue;
    switch (b.type) {
      case "text":
        out.push({ type: "text", text: str(b.text) ?? "" });
        break;
      case "image":
        out.push({ type: "image", source: parseImageSource(b.source) });
        break;
      case "tool_use":
        out.push({ type: "tool_use", id: str(b.id) ?? genId("toolu"), name: str(b.name) ?? "", input: b.input ?? {} });
        break;
      case "tool_result":
        out.push({
          type: "tool_result",
          toolUseId: str(b.tool_use_id) ?? "",
          content: parseBlocks(b.content ?? "", `${where}.tool_result`),
          isError: b.is_error === true || undefined,
        });
        break;
      case "thinking":
        out.push({ type: "reasoning", text: str(b.thinking) ?? "" });
        break;
      case "redacted_thinking":
        break;
      default:
        throw new UnsupportedFieldError(`${where} 中的 ${String(b.type)} 内容块`);
    }
  }
  return out;
}

function parseToolChoice(v: unknown): IrToolChoice | undefined {
  if (!isObj(v)) return undefined;
  switch (v.type) {
    case "auto":
      return { type: "auto" };
    case "any":
      return { type: "required" };
    case "none":
      return { type: "none" };
    case "tool":
      return { type: "tool", name: str(v.name) ?? "" };
    default:
      return undefined;
  }
}

function buildImageSource(src: IrImageSource) {
  return src.type === "base64" ? { type: "base64", media_type: src.mediaType, data: src.data } : { type: "url", url: src.url };
}

function buildBlocks(parts: readonly IrPart[]): Obj[] {
  const out: Obj[] = [];
  for (const p of parts) {
    switch (p.type) {
      case "text":
        if (p.text) out.push({ type: "text", text: p.text });
        break;
      case "image":
        out.push({ type: "image", source: buildImageSource(p.source) });
        break;
      case "tool_use":
        out.push({ type: "tool_use", id: p.id, name: p.name, input: isObj(p.input) ? p.input : {} });
        break;
      case "tool_result": {
        const content = buildBlocks(p.content);
        out.push({ type: "tool_result", tool_use_id: p.toolUseId, content, ...(p.isError ? { is_error: true } : {}) });
        break;
      }
      case "reasoning":
        break; // 跨协议无法提供签名，丢弃
    }
  }
  return out;
}

function mapStop(v: unknown): IrStopReason {
  return v === "max_tokens" || v === "stop_sequence" || v === "tool_use" ? v : "end_turn";
}
/**
 * Anthropic 的 input_tokens 本就**不含**缓存部分，因此不再求和：
 * 缓存命中与写入各自单独计价，混进 inputTokens 会重复计费。
 * cache_creation_input_tokens 在新版 API 可能是按 TTL 分层的对象（如 {ephemeral_5m_input_tokens: n}），两种形状都要读。
 */
function cacheCreationTokens(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!isObj(v)) return 0;
  let total = 0;
  for (const n of Object.values(v)) if (typeof n === "number" && Number.isFinite(n)) total += n;
  return total;
}

function parseUsage(u: unknown): IrUsage {
  if (!isObj(u)) return {};
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheWriteTokens: u.cache_creation_input_tokens === undefined ? undefined : cacheCreationTokens(u.cache_creation_input_tokens),
  };
}

export const anthropicCodec: Codec = {
  parseRequest(body) {
    for (const f of UNSUPPORTED) if (present(body, f)) throw new UnsupportedFieldError(f);

    const tools = asArray(body.tools).map((t) => {
      if (!isObj(t)) throw new InvalidRequestError("tools 项必须是对象");
      if (t.type !== undefined && t.type !== "custom") throw new UnsupportedFieldError(`内置工具 ${String(t.type)}`);
      return {
        name: str(t.name) ?? "",
        description: str(t.description),
        inputSchema: isObj(t.input_schema) ? t.input_schema : { type: "object", properties: {} },
      };
    });

    const messages: IrMessage[] = asArray(body.messages).map((m, i) => {
      if (!isObj(m) || (m.role !== "user" && m.role !== "assistant")) throw new InvalidRequestError(`messages[${i}].role 不合法`);
      return { role: m.role, content: parseBlocks(m.content, `messages[${i}]`) };
    });

    const stop = asArray(body.stop_sequences).filter((s): s is string => typeof s === "string");
    return {
      system: parseBlocks(body.system ?? "", "system"),
      messages,
      tools,
      toolChoice: parseToolChoice(body.tool_choice),
      maxTokens: num(body.max_tokens),
      temperature: num(body.temperature),
      topP: num(body.top_p),
      stopSequences: stop,
      stream: body.stream === true,
    };
  },

  buildRequest(ir, model) {
    const out: Obj = {
      model,
      max_tokens: ir.maxTokens,
      messages: mergeAdjacent(ir.messages)
        .map((m) => ({ role: m.role, content: buildBlocks(m.content) }))
        .filter((m) => m.content.length > 0),
    };
    const system = buildBlocks(ir.system);
    if (system.length) out.system = system;
    if (ir.tools.length) {
      out.tools = ir.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
      const c = ir.toolChoice;
      if (c) out.tool_choice = c.type === "required" ? { type: "any" } : c.type === "tool" ? { type: "tool", name: c.name } : { type: c.type };
    }
    if (ir.temperature !== undefined) out.temperature = ir.temperature;
    if (ir.topP !== undefined) out.top_p = ir.topP;
    if (ir.stopSequences.length) out.stop_sequences = ir.stopSequences;
    if (ir.stream) out.stream = true;
    return out;
  },

  parseResponse(body) {
    const b = isObj(body) ? body : {};
    return {
      id: str(b.id),
      model: str(b.model),
      stopReason: mapStop(b.stop_reason),
      content: parseBlocks(b.content ?? [], "content"),
      usage: parseUsage(b.usage),
    };
  },

  buildResponse(ir, ctx) {
    return {
      id: ir.id?.startsWith("msg_") ? ir.id : genId("msg"),
      type: "message",
      role: "assistant",
      model: ctx.model,
      content: buildBlocks(ir.content),
      stop_reason: ir.stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: ir.usage.inputTokens ?? 0,
        output_tokens: ir.usage.outputTokens ?? 0,
        ...(ir.usage.cacheReadTokens ? { cache_read_input_tokens: ir.usage.cacheReadTokens } : {}),
        ...(ir.usage.cacheWriteTokens ? { cache_creation_input_tokens: ir.usage.cacheWriteTokens } : {}),
      },
    };
  },

  async *decodeStream(events) {
    let started = false;
    let stopped = false;
    for await (const ev of events) {
      const d = parseJson(ev.data);
      if (!isObj(d)) continue;
      switch (d.type) {
        case "message_start": {
          const msg = isObj(d.message) ? d.message : {};
          started = true;
          yield { type: "message_start", id: str(msg.id), usage: parseUsage(msg.usage) };
          break;
        }
        case "content_block_start": {
          const index = num(d.index) ?? 0;
          const b = isObj(d.content_block) ? d.content_block : {};
          if (b.type === "text") yield { type: "block_start", index, part: { type: "text", text: "" } };
          else if (b.type === "tool_use")
            yield { type: "block_start", index, part: { type: "tool_use", id: str(b.id) ?? "", name: str(b.name) ?? "", input: {} } };
          else if (b.type === "thinking" || b.type === "redacted_thinking")
            yield { type: "block_start", index, part: { type: "reasoning", text: "" } };
          break;
        }
        case "content_block_delta": {
          const index = num(d.index) ?? 0;
          const delta = isObj(d.delta) ? d.delta : {};
          if (delta.type === "text_delta") yield { type: "text_delta", index, text: str(delta.text) ?? "" };
          else if (delta.type === "input_json_delta") yield { type: "json_delta", index, partialJson: str(delta.partial_json) ?? "" };
          else if (delta.type === "thinking_delta") yield { type: "reasoning_delta", index, text: str(delta.thinking) ?? "" };
          break;
        }
        case "content_block_stop":
          yield { type: "block_stop", index: num(d.index) ?? 0 };
          break;
        case "message_delta": {
          const delta = isObj(d.delta) ? d.delta : {};
          const usage = parseUsage(d.usage);
          yield {
            type: "message_delta",
            stopReason: delta.stop_reason ? mapStop(delta.stop_reason) : undefined,
            // message_delta 里的 input_tokens 仅在部分版本出现，没有就不覆盖
            usage: { outputTokens: usage.outputTokens, ...(usage.inputTokens ? { inputTokens: usage.inputTokens } : {}) },
          };
          break;
        }
        case "message_stop":
          stopped = true;
          yield { type: "message_stop" };
          break;
        case "error": {
          const err = isObj(d.error) ? d.error : {};
          throw new UpstreamStreamError(str(err.message) ?? "上游流式响应出错");
        }
      }
    }
    if (!started) throw new UpstreamStreamError("上游流在 message_start 之前结束");
    if (!stopped) yield { type: "message_stop" };
  },

  async *encodeStream(events, ctx) {
    let id = genId("msg");
    let stopReason: IrStopReason = "end_turn";
    let usage: IrUsage = {};
    for await (const ev of events) {
      switch (ev.type) {
        case "message_start":
          usage = { ...ev.usage, outputTokens: 0 };
          if (ev.id?.startsWith("msg_")) id = ev.id;
          yield sse(
            {
              type: "message_start",
              message: {
                id,
                type: "message",
                role: "assistant",
                model: ctx.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: {
                  input_tokens: usage.inputTokens ?? 0,
                  output_tokens: 0,
                  ...(usage.cacheReadTokens ? { cache_read_input_tokens: usage.cacheReadTokens } : {}),
                  ...(usage.cacheWriteTokens ? { cache_creation_input_tokens: usage.cacheWriteTokens } : {}),
                },
              },
            },
            "message_start",
          );
          break;
        case "block_start": {
          const p = ev.part;
          const block =
            p.type === "tool_use" ? { type: "tool_use", id: p.id, name: p.name, input: {} } : { type: "text", text: "" };
          yield sse({ type: "content_block_start", index: ev.index, content_block: block }, "content_block_start");
          break;
        }
        case "text_delta":
          yield sse({ type: "content_block_delta", index: ev.index, delta: { type: "text_delta", text: ev.text } }, "content_block_delta");
          break;
        case "json_delta":
          yield sse(
            { type: "content_block_delta", index: ev.index, delta: { type: "input_json_delta", partial_json: ev.partialJson } },
            "content_block_delta",
          );
          break;
        case "block_stop":
          yield sse({ type: "content_block_stop", index: ev.index }, "content_block_stop");
          break;
        case "message_delta":
          if (ev.stopReason) stopReason = ev.stopReason;
          // 缓存字段只在 message_start 出现，这里只在有值时覆盖，避免被清零
          if (ev.usage?.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
          if (ev.usage?.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
          if (ev.usage?.cacheReadTokens !== undefined) usage.cacheReadTokens = ev.usage.cacheReadTokens;
          if (ev.usage?.cacheWriteTokens !== undefined) usage.cacheWriteTokens = ev.usage.cacheWriteTokens;
          break;
        case "message_stop":
          yield sse(
            {
              type: "message_delta",
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: {
                input_tokens: usage.inputTokens ?? 0,
                output_tokens: usage.outputTokens ?? 0,
                ...(usage.cacheReadTokens ? { cache_read_input_tokens: usage.cacheReadTokens } : {}),
                ...(usage.cacheWriteTokens ? { cache_creation_input_tokens: usage.cacheWriteTokens } : {}),
              },
            },
            "message_delta",
          );
          yield sse({ type: "message_stop" }, "message_stop");
          break;
      }
    }
  },

  streamError(message): SseEvent[] {
    return [sse({ type: "error", error: { type: "api_error", message } }, "error")];
  },
};
