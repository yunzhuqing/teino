import {
  asArray,
  genId,
  InvalidRequestError,
  isObj,
  num,
  parseToolArguments,
  present,
  str,
  textOf,
  UnsupportedFieldError,
  type IrMessage,
  type IrPart,
  type IrStopReason,
  type IrToolChoice,
  type IrUsage,
  type Obj,
} from "../ir";
import type { SseEvent } from "../sse";
import { imageFromUrl, imageToUrl, parseJson, sse, UpstreamStreamError, type Codec } from "./shared";

/** 存在即不支持（会改变输出语义，IR 无法表达） */
const UNSUPPORTED = ["logit_bias", "top_logprobs", "audio", "prediction", "web_search_options", "functions", "function_call"];

function rejectUnsupported(body: Obj) {
  for (const f of UNSUPPORTED) if (present(body, f)) throw new UnsupportedFieldError(f);
  if (body.logprobs === true) throw new UnsupportedFieldError("logprobs");
  if ((num(body.n) ?? 1) > 1) throw new UnsupportedFieldError("n", "仅支持 n=1");
  for (const f of ["presence_penalty", "frequency_penalty"]) if ((num(body[f]) ?? 0) !== 0) throw new UnsupportedFieldError(f);
  if (isObj(body.response_format) && body.response_format.type !== "text") throw new UnsupportedFieldError("response_format");
  const modalities = asArray(body.modalities);
  if (modalities.some((m) => m !== "text")) throw new UnsupportedFieldError("modalities");
}

function parseUserContent(content: unknown, where: string): IrPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const out: IrPart[] = [];
  for (const p of asArray(content)) {
    if (!isObj(p)) continue;
    if (p.type === "text") out.push({ type: "text", text: str(p.text) ?? "" });
    else if (p.type === "image_url") {
      const url = isObj(p.image_url) ? str(p.image_url.url) : str(p.image_url);
      if (!url) throw new InvalidRequestError(`${where}.image_url.url 缺失`);
      out.push({ type: "image", source: imageFromUrl(url) });
    } else if (p.type === "refusal") out.push({ type: "text", text: str(p.refusal) ?? "" });
    else throw new UnsupportedFieldError(`${where} 中的 ${String(p.type)} 内容`);
  }
  return out;
}

function parseToolChoice(v: unknown): IrToolChoice | undefined {
  if (v === "auto" || v === "none" || v === "required") return { type: v };
  if (isObj(v) && isObj(v.function)) return { type: "tool", name: str(v.function.name) ?? "" };
  if (isObj(v)) throw new UnsupportedFieldError(`tool_choice.type=${String(v.type)}`);
  return undefined;
}

function mapFinish(v: unknown): IrStopReason {
  if (v === "length") return "max_tokens";
  if (v === "tool_calls" || v === "function_call") return "tool_use";
  return "end_turn";
}

function finishOf(r: IrStopReason): string {
  return r === "max_tokens" ? "length" : r === "tool_use" ? "tool_calls" : "stop";
}

function parseUsage(u: unknown): IrUsage {
  return isObj(u) ? { inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens) } : {};
}

function buildUsage(u: IrUsage) {
  const p = u.inputTokens ?? 0;
  const c = u.outputTokens ?? 0;
  return { prompt_tokens: p, completion_tokens: c, total_tokens: p + c };
}

function buildUserParts(parts: IrPart[]): string | Obj[] {
  if (parts.every((p) => p.type === "text")) return textOf(parts);
  return parts.flatMap((p): Obj[] => {
    if (p.type === "text") return [{ type: "text", text: p.text }];
    if (p.type === "image") return [{ type: "image_url", image_url: { url: imageToUrl(p.source) } }];
    return [];
  });
}

function buildMessages(ir: { system: IrPart[]; messages: IrMessage[] }): Obj[] {
  const out: Obj[] = [];
  const system = textOf(ir.system);
  if (system) out.push({ role: "system", content: system });

  for (const m of ir.messages) {
    if (m.role === "assistant") {
      const toolCalls = m.content.flatMap((p) =>
        p.type === "tool_use" ? [{ id: p.id, type: "function", function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } }] : [],
      );
      const text = textOf(m.content);
      if (!text && toolCalls.length === 0) continue;
      out.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    // user：工具结果必须紧跟 assistant 的 tool_calls，先输出 tool 消息再输出其余内容
    const rest: IrPart[] = [];
    for (const p of m.content) {
      if (p.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: p.toolUseId, content: textOf(p.content) });
        // tool 消息只能是文本，图片挪到后续 user 消息
        rest.push(...p.content.filter((c) => c.type === "image"));
      } else if (p.type === "text" || p.type === "image") rest.push(p);
    }
    if (rest.length) out.push({ role: "user", content: buildUserParts(rest) });
  }
  return out;
}

export const openaiChatCodec: Codec = {
  parseRequest(body) {
    rejectUnsupported(body);
    const system: IrPart[] = [];
    const messages: IrMessage[] = [];

    asArray(body.messages).forEach((m, i) => {
      if (!isObj(m)) throw new InvalidRequestError(`messages[${i}] 必须是对象`);
      const where = `messages[${i}]`;
      switch (m.role) {
        case "system":
        case "developer":
          system.push(...parseUserContent(m.content, where));
          break;
        case "user":
          messages.push({ role: "user", content: parseUserContent(m.content, where) });
          break;
        case "assistant": {
          const content = m.content === null || m.content === undefined ? [] : parseUserContent(m.content, where);
          for (const tc of asArray(m.tool_calls)) {
            if (!isObj(tc) || !isObj(tc.function)) continue;
            content.push({
              type: "tool_use",
              id: str(tc.id) ?? genId("call"),
              name: str(tc.function.name) ?? "",
              input: parseToolArguments(tc.function.arguments, `${where}.tool_calls.function.arguments`),
            });
          }
          messages.push({ role: "assistant", content });
          break;
        }
        case "tool":
          messages.push({
            role: "user",
            content: [{ type: "tool_result", toolUseId: str(m.tool_call_id) ?? "", content: parseUserContent(m.content ?? "", where) }],
          });
          break;
        default:
          throw new UnsupportedFieldError(`${where}.role=${String(m.role)}`);
      }
    });

    const tools = asArray(body.tools).map((t) => {
      if (!isObj(t) || t.type !== "function" || !isObj(t.function)) throw new UnsupportedFieldError(`tools 中的 ${isObj(t) ? String(t.type) : "非法"} 工具`);
      return {
        name: str(t.function.name) ?? "",
        description: str(t.function.description),
        inputSchema: isObj(t.function.parameters) ? t.function.parameters : { type: "object", properties: {} },
      };
    });

    const stop = typeof body.stop === "string" ? [body.stop] : asArray(body.stop).filter((s): s is string => typeof s === "string");
    return {
      system,
      messages,
      tools,
      toolChoice: parseToolChoice(body.tool_choice),
      maxTokens: num(body.max_completion_tokens) ?? num(body.max_tokens),
      temperature: num(body.temperature),
      topP: num(body.top_p),
      stopSequences: stop,
      stream: body.stream === true,
    };
  },

  buildRequest(ir, model) {
    const out: Obj = { model, messages: buildMessages(ir) };
    if (ir.tools.length) {
      out.tools = ir.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      const c = ir.toolChoice;
      if (c) out.tool_choice = c.type === "tool" ? { type: "function", function: { name: c.name } } : c.type;
    }
    if (ir.maxTokens !== undefined) out.max_tokens = ir.maxTokens;
    if (ir.temperature !== undefined) out.temperature = ir.temperature;
    if (ir.topP !== undefined) out.top_p = ir.topP;
    if (ir.stopSequences.length) out.stop = ir.stopSequences;
    if (ir.stream) {
      out.stream = true;
      out.stream_options = { include_usage: true };
    }
    return out;
  },

  parseResponse(body) {
    const b = isObj(body) ? body : {};
    const choice = isObj(asArray(b.choices)[0]) ? (asArray(b.choices)[0] as Obj) : {};
    const msg = isObj(choice.message) ? choice.message : {};
    const content: IrPart[] = [];
    const reasoning = str(msg.reasoning_content);
    if (reasoning) content.push({ type: "reasoning", text: reasoning });
    const text = typeof msg.content === "string" ? msg.content : undefined;
    if (text) content.push({ type: "text", text });
    for (const tc of asArray(msg.tool_calls)) {
      if (!isObj(tc) || !isObj(tc.function)) continue;
      content.push({
        type: "tool_use",
        id: str(tc.id) ?? genId("call"),
        name: str(tc.function.name) ?? "",
        input: parseToolArguments(tc.function.arguments, "tool_calls.function.arguments"),
      });
    }
    return { id: str(b.id), model: str(b.model), stopReason: mapFinish(choice.finish_reason), content, usage: parseUsage(b.usage) };
  },

  buildResponse(ir, ctx) {
    const toolCalls = ir.content.flatMap((p) =>
      p.type === "tool_use" ? [{ id: p.id, type: "function", function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } }] : [],
    );
    const text = textOf(ir.content);
    return {
      id: genId("chatcmpl"),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: ctx.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
          finish_reason: finishOf(ir.stopReason),
          logprobs: null,
        },
      ],
      usage: buildUsage(ir.usage),
    };
  },

  async *decodeStream(events) {
    let started = false;
    let index = -1;
    type OpenBlock = { kind: "text" | "reasoning" } | { kind: "tool"; toolIndex: number };
    // 用 as 避免 TS 把只在闭包里赋值的变量收窄为 null
    let open = null as OpenBlock | null;
    let stopReason: IrStopReason | undefined;
    const usage: IrUsage = {};

    function* openBlock(next: OpenBlock, part: IrPart) {
      if (open) yield { type: "block_stop" as const, index };
      open = next;
      index++;
      yield { type: "block_start" as const, index, part };
    }

    for await (const ev of events) {
      if (ev.data.trim() === "[DONE]") break;
      const d = parseJson(ev.data);
      if (!isObj(d)) continue;
      if (isObj(d.error)) throw new UpstreamStreamError(str(d.error.message) ?? "上游流式响应出错");
      if (!started) {
        started = true;
        yield { type: "message_start" as const, id: str(d.id) };
      }
      if (isObj(d.usage)) Object.assign(usage, parseUsage(d.usage));

      const choice = asArray(d.choices)[0];
      if (!isObj(choice)) continue;
      const delta = isObj(choice.delta) ? choice.delta : {};

      const reasoning = str(delta.reasoning_content);
      if (reasoning) {
        if (open?.kind !== "reasoning") yield* openBlock({ kind: "reasoning" }, { type: "reasoning", text: "" });
        yield { type: "reasoning_delta" as const, index, text: reasoning };
      }
      const text = str(delta.content);
      if (text) {
        if (open?.kind !== "text") yield* openBlock({ kind: "text" }, { type: "text", text: "" });
        yield { type: "text_delta" as const, index, text };
      }
      for (const tc of asArray(delta.tool_calls)) {
        if (!isObj(tc)) continue;
        const toolIndex = num(tc.index) ?? 0;
        const fn = isObj(tc.function) ? tc.function : {};
        if (open?.kind !== "tool" || open.toolIndex !== toolIndex) {
          yield* openBlock(
            { kind: "tool", toolIndex },
            { type: "tool_use", id: str(tc.id) ?? genId("call"), name: str(fn.name) ?? "", input: {} },
          );
        }
        const args = str(fn.arguments);
        if (args) yield { type: "json_delta" as const, index, partialJson: args };
      }
      if (choice.finish_reason) stopReason = mapFinish(choice.finish_reason);
    }

    if (!started) throw new UpstreamStreamError("上游流未返回任何数据");
    if (open) yield { type: "block_stop" as const, index };
    yield { type: "message_delta" as const, stopReason: stopReason ?? "end_turn", usage };
    yield { type: "message_stop" as const };
  },

  async *encodeStream(events, ctx) {
    const id = genId("chatcmpl");
    const created = Math.floor(Date.now() / 1000);
    const includeUsage = isObj(ctx.request.stream_options) && ctx.request.stream_options.include_usage === true;
    const toolIndexOf = new Map<number, number>();
    let stopReason: IrStopReason = "end_turn";
    const usage: IrUsage = {};
    const chunk = (delta: Obj, finish: string | null = null): SseEvent =>
      sse({ id, object: "chat.completion.chunk", created, model: ctx.model, choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }] });

    for await (const ev of events) {
      switch (ev.type) {
        case "message_start":
          Object.assign(usage, ev.usage);
          yield chunk({ role: "assistant", content: "" });
          break;
        case "block_start":
          if (ev.part.type === "tool_use") {
            const ti = toolIndexOf.size;
            toolIndexOf.set(ev.index, ti);
            yield chunk({ tool_calls: [{ index: ti, id: ev.part.id, type: "function", function: { name: ev.part.name, arguments: "" } }] });
          }
          break;
        case "text_delta":
          yield chunk({ content: ev.text });
          break;
        case "json_delta":
          yield chunk({ tool_calls: [{ index: toolIndexOf.get(ev.index) ?? 0, function: { arguments: ev.partialJson } }] });
          break;
        case "message_delta":
          if (ev.stopReason) stopReason = ev.stopReason;
          if (ev.usage?.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
          if (ev.usage?.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
          break;
        case "message_stop":
          yield chunk({}, finishOf(stopReason));
          if (includeUsage) yield sse({ id, object: "chat.completion.chunk", created, model: ctx.model, choices: [], usage: buildUsage(usage) });
          yield { data: "[DONE]" };
          break;
      }
    }
  },

  streamError(message) {
    return [sse({ error: { message, type: "server_error", code: 502 } }), { data: "[DONE]" }];
  },
};
