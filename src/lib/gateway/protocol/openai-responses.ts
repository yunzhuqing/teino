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
import { imageFromUrl, imageToUrl, parseJson, sse, UpstreamStreamError, type Codec } from "./shared";

/** 依赖 OpenAI 服务端状态或专有能力，跨协议无法实现 */
const UNSUPPORTED = ["previous_response_id", "conversation", "prompt", "top_logprobs", "max_tool_calls"];
/** include 中允许出现的项（推理内容跨协议本就丢弃，请求它无害） */
const HARMLESS_INCLUDE = new Set(["reasoning.encrypted_content"]);

function rejectUnsupported(body: Obj) {
  for (const f of UNSUPPORTED) if (present(body, f)) throw new UnsupportedFieldError(f);
  if (body.store === true) throw new UnsupportedFieldError("store", "跨协议调用无法在服务端保存响应，请传 store: false");
  if (body.background === true) throw new UnsupportedFieldError("background");
  if (body.truncation === "auto") throw new UnsupportedFieldError("truncation");
  const include = asArray(body.include).find((i) => !HARMLESS_INCLUDE.has(String(i)));
  if (include !== undefined) throw new UnsupportedFieldError(`include: ${String(include)}`);
  const format = isObj(body.text) && isObj(body.text.format) ? body.text.format.type : undefined;
  if (format !== undefined && format !== "text") throw new UnsupportedFieldError("text.format", `type=${String(format)}`);
}

function parseContent(content: unknown, where: string): IrPart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const out: IrPart[] = [];
  for (const p of asArray(content)) {
    if (!isObj(p)) continue;
    switch (p.type) {
      case "input_text":
      case "output_text":
        out.push({ type: "text", text: str(p.text) ?? "" });
        break;
      case "refusal":
        out.push({ type: "text", text: str(p.refusal) ?? "" });
        break;
      case "input_image": {
        const url = str(p.image_url);
        if (!url) throw new UnsupportedFieldError(`${where}.input_image.file_id`, "仅支持 image_url");
        out.push({ type: "image", source: imageFromUrl(url) });
        break;
      }
      default:
        throw new UnsupportedFieldError(`${where} 中的 ${String(p.type)} 内容`);
    }
  }
  return out;
}

function parseToolChoice(v: unknown): IrToolChoice | undefined {
  if (v === "auto" || v === "none" || v === "required") return { type: v };
  if (isObj(v) && v.type === "function") return { type: "tool", name: str(v.name) ?? "" };
  if (isObj(v)) throw new UnsupportedFieldError(`tool_choice.type=${String(v.type)}`);
  return undefined;
}

function parseUsage(u: unknown): IrUsage {
  return isObj(u) ? { inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) } : {};
}

function buildUsage(u: IrUsage) {
  const i = u.inputTokens ?? 0;
  const o = u.outputTokens ?? 0;
  return {
    input_tokens: i,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: o,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: i + o,
  };
}

function stopFromResponse(r: Obj, hasToolUse: boolean): IrStopReason {
  if (r.status === "incomplete" && isObj(r.incomplete_details) && r.incomplete_details.reason === "max_output_tokens") return "max_tokens";
  return hasToolUse ? "tool_use" : "end_turn";
}

function messageItem(id: string, text: string, status = "completed") {
  return { id, type: "message", status, role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
}

function functionCallItem(id: string, callId: string, name: string, args: string, status = "completed") {
  return { id, type: "function_call", status, call_id: callId, name, arguments: args };
}

function responseObject(o: { id: string; model: string; status: string; output: Obj[]; usage: IrUsage | null; stop?: IrStopReason }) {
  return {
    id: o.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: o.status,
    error: null,
    incomplete_details: o.stop === "max_tokens" ? { reason: "max_output_tokens" } : null,
    model: o.model,
    output: o.output,
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
    store: false,
    usage: o.usage ? buildUsage(o.usage) : null,
    metadata: {},
  };
}

export const openaiResponsesCodec: Codec = {
  parseRequest(body) {
    rejectUnsupported(body);
    const system = parseContent(body.instructions ?? "", "instructions");
    const messages: IrMessage[] = [];
    const input = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : asArray(body.input);

    input.forEach((item, i) => {
      if (!isObj(item)) throw new InvalidRequestError(`input[${i}] 必须是对象`);
      const where = `input[${i}]`;
      const type = item.type ?? (item.role ? "message" : undefined);
      switch (type) {
        case "message": {
          const content = parseContent(item.content, where);
          if (item.role === "system" || item.role === "developer") system.push(...content);
          else if (item.role === "user" || item.role === "assistant") messages.push({ role: item.role, content });
          else throw new InvalidRequestError(`${where}.role 不合法`);
          break;
        }
        case "function_call":
          messages.push({
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: str(item.call_id) ?? genId("call"),
                name: str(item.name) ?? "",
                input: parseToolArguments(item.arguments, `${where}.arguments`),
              },
            ],
          });
          break;
        case "function_call_output":
          messages.push({
            role: "user",
            content: [{ type: "tool_result", toolUseId: str(item.call_id) ?? "", content: parseContent(item.output ?? "", where) }],
          });
          break;
        case "reasoning":
          break; // 推理项跨协议丢弃
        default:
          throw new UnsupportedFieldError(`${where}.type=${String(type)}`);
      }
    });

    const tools = asArray(body.tools).map((t) => {
      if (!isObj(t) || t.type !== "function") throw new UnsupportedFieldError(`内置工具 ${isObj(t) ? String(t.type) : "非法"}`);
      return {
        name: str(t.name) ?? "",
        description: str(t.description),
        inputSchema: isObj(t.parameters) ? t.parameters : { type: "object", properties: {} },
      };
    });

    return {
      system,
      messages,
      tools,
      toolChoice: parseToolChoice(body.tool_choice),
      maxTokens: num(body.max_output_tokens),
      temperature: num(body.temperature),
      topP: num(body.top_p),
      stopSequences: [],
      stream: body.stream === true,
    };
  },

  buildRequest(ir, model) {
    if (ir.stopSequences.length) throw new UnsupportedFieldError("stop_sequences", "Responses API 不支持停止词");
    const input: Obj[] = [];
    for (const m of ir.messages) {
      let buf: Obj[] = [];
      const flush = () => {
        if (buf.length) input.push({ type: "message", role: m.role, content: buf });
        buf = [];
      };
      for (const p of m.content) {
        if (p.type === "text") buf.push({ type: m.role === "user" ? "input_text" : "output_text", text: p.text });
        else if (p.type === "image") buf.push({ type: "input_image", image_url: imageToUrl(p.source) });
        else if (p.type === "tool_use") {
          flush();
          input.push({ type: "function_call", call_id: p.id, name: p.name, arguments: JSON.stringify(p.input ?? {}) });
        } else if (p.type === "tool_result") {
          flush();
          input.push({ type: "function_call_output", call_id: p.toolUseId, output: textOf(p.content) });
        }
      }
      flush();
    }

    const out: Obj = { model, input, store: false };
    const instructions = textOf(ir.system);
    if (instructions) out.instructions = instructions;
    if (ir.tools.length) {
      out.tools = ir.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema }));
      const c = ir.toolChoice;
      if (c) out.tool_choice = c.type === "tool" ? { type: "function", name: c.name } : c.type;
    }
    if (ir.maxTokens !== undefined) out.max_output_tokens = ir.maxTokens;
    if (ir.temperature !== undefined) out.temperature = ir.temperature;
    if (ir.topP !== undefined) out.top_p = ir.topP;
    if (ir.stream) out.stream = true;
    return out;
  },

  parseResponse(body) {
    const b = isObj(body) ? body : {};
    const content: IrPart[] = [];
    for (const item of asArray(b.output)) {
      if (!isObj(item)) continue;
      if (item.type === "message") content.push(...parseContent(item.content, "output"));
      else if (item.type === "function_call")
        content.push({
          type: "tool_use",
          id: str(item.call_id) ?? genId("call"),
          name: str(item.name) ?? "",
          input: parseToolArguments(item.arguments, "output.function_call.arguments"),
        });
      else if (item.type === "reasoning") {
        const text = asArray(item.summary).map((s) => (isObj(s) ? (str(s.text) ?? "") : "")).join("\n");
        content.push({ type: "reasoning", text });
      }
    }
    return {
      id: str(b.id),
      model: str(b.model),
      stopReason: stopFromResponse(b, content.some((p) => p.type === "tool_use")),
      content,
      usage: parseUsage(b.usage),
    };
  },

  buildResponse(ir, ctx) {
    const output: Obj[] = [];
    const text = textOf(ir.content);
    if (text) output.push(messageItem(genId("msg"), text));
    for (const p of ir.content) {
      if (p.type === "tool_use") output.push(functionCallItem(genId("fc"), p.id, p.name, JSON.stringify(p.input ?? {})));
    }
    return responseObject({
      id: genId("resp"),
      model: ctx.model,
      status: ir.stopReason === "max_tokens" ? "incomplete" : "completed",
      output,
      usage: ir.usage,
      stop: ir.stopReason,
    });
  },

  async *decodeStream(events) {
    let started = false;
    let index = -1;
    /** 当前打开的块：key 区分 output_index / content_index */
    let open = null as { key: string; kind: "text" | "tool"; deltas: number } | null;
    let sawTool = false;

    function* close() {
      if (open) yield { type: "block_stop" as const, index };
      open = null;
    }
    function* openBlock(key: string, kind: "text" | "tool", part: IrPart) {
      yield* close();
      index++;
      open = { key, kind, deltas: 0 };
      yield { type: "block_start" as const, index, part };
    }

    for await (const ev of events) {
      const d = parseJson(ev.data);
      if (!isObj(d)) continue;
      const out = num(d.output_index) ?? 0;
      switch (d.type) {
        case "response.created": {
          started = true;
          const r = isObj(d.response) ? d.response : {};
          yield { type: "message_start" as const, id: str(r.id) };
          break;
        }
        case "response.output_item.added": {
          const item = isObj(d.item) ? d.item : {};
          if (item.type === "function_call") {
            sawTool = true;
            yield* openBlock(`${out}`, "tool", { type: "tool_use", id: str(item.call_id) ?? genId("call"), name: str(item.name) ?? "", input: {} });
          }
          break;
        }
        case "response.output_text.delta": {
          const key = `${out}:${num(d.content_index) ?? 0}`;
          if (open?.key !== key) yield* openBlock(key, "text", { type: "text", text: "" });
          open!.deltas++;
          yield { type: "text_delta" as const, index, text: str(d.delta) ?? "" };
          break;
        }
        case "response.function_call_arguments.delta":
          if (open?.kind === "tool" && open.key === `${out}`) {
            open.deltas++;
            yield { type: "json_delta" as const, index, partialJson: str(d.delta) ?? "" };
          }
          break;
        case "response.output_item.done": {
          const item = isObj(d.item) ? d.item : {};
          // 部分实现不发 arguments.delta，只在 done 里给完整参数
          if (open?.kind === "tool" && open.key === `${out}` && open.deltas === 0 && str(item.arguments))
            yield { type: "json_delta" as const, index, partialJson: str(item.arguments)! };
          if (open && open.key.split(":")[0] === `${out}`) yield* close();
          break;
        }
        case "response.completed":
        case "response.incomplete": {
          const r = isObj(d.response) ? d.response : {};
          yield* close();
          yield { type: "message_delta" as const, stopReason: stopFromResponse(r, sawTool), usage: parseUsage(r.usage) };
          yield { type: "message_stop" as const };
          return;
        }
        case "response.failed": {
          const r = isObj(d.response) ? d.response : {};
          const err = isObj(r.error) ? r.error : {};
          throw new UpstreamStreamError(str(err.message) ?? "上游响应失败");
        }
        case "error":
          throw new UpstreamStreamError(str(d.message) ?? "上游流式响应出错");
      }
    }
    if (!started) throw new UpstreamStreamError("上游流未返回任何数据");
    yield* close();
    yield { type: "message_delta" as const, stopReason: sawTool ? "tool_use" : "end_turn" };
    yield { type: "message_stop" as const };
  },

  async *encodeStream(events, ctx) {
    const respId = genId("resp");
    let seq = 0;
    const emit = (type: string, payload: Obj) => sse({ type, sequence_number: seq++, ...payload }, type);

    const output: Obj[] = [];
    const blocks = new Map<number, { outputIndex: number; itemId: string; kind: "text" | "tool"; buf: string; callId: string; name: string }>();
    let stopReason: IrStopReason = "end_turn";
    const usage: IrUsage = {};

    for await (const ev of events) {
      switch (ev.type) {
        case "message_start": {
          Object.assign(usage, ev.usage);
          const r = responseObject({ id: respId, model: ctx.model, status: "in_progress", output: [], usage: null });
          yield emit("response.created", { response: r });
          yield emit("response.in_progress", { response: r });
          break;
        }
        case "block_start": {
          const outputIndex = output.length;
          output.push({}); // 占位，block_stop 时填入完成态
          if (ev.part.type === "tool_use") {
            const b = { outputIndex, itemId: genId("fc"), kind: "tool" as const, buf: "", callId: ev.part.id, name: ev.part.name };
            blocks.set(ev.index, b);
            yield emit("response.output_item.added", { output_index: outputIndex, item: functionCallItem(b.itemId, b.callId, b.name, "", "in_progress") });
          } else {
            const b = { outputIndex, itemId: genId("msg"), kind: "text" as const, buf: "", callId: "", name: "" };
            blocks.set(ev.index, b);
            yield emit("response.output_item.added", {
              output_index: outputIndex,
              item: { id: b.itemId, type: "message", status: "in_progress", role: "assistant", content: [] },
            });
            yield emit("response.content_part.added", {
              item_id: b.itemId,
              output_index: outputIndex,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            });
          }
          break;
        }
        case "text_delta": {
          const b = blocks.get(ev.index);
          if (!b) break;
          b.buf += ev.text;
          yield emit("response.output_text.delta", { item_id: b.itemId, output_index: b.outputIndex, content_index: 0, delta: ev.text, logprobs: [] });
          break;
        }
        case "json_delta": {
          const b = blocks.get(ev.index);
          if (!b) break;
          b.buf += ev.partialJson;
          yield emit("response.function_call_arguments.delta", { item_id: b.itemId, output_index: b.outputIndex, delta: ev.partialJson });
          break;
        }
        case "block_stop": {
          const b = blocks.get(ev.index);
          if (!b) break;
          if (b.kind === "tool") {
            const args = b.buf || "{}";
            yield emit("response.function_call_arguments.done", { item_id: b.itemId, output_index: b.outputIndex, arguments: args });
            output[b.outputIndex] = functionCallItem(b.itemId, b.callId, b.name, args);
          } else {
            const part = { type: "output_text", text: b.buf, annotations: [] };
            yield emit("response.output_text.done", { item_id: b.itemId, output_index: b.outputIndex, content_index: 0, text: b.buf, logprobs: [] });
            yield emit("response.content_part.done", { item_id: b.itemId, output_index: b.outputIndex, content_index: 0, part });
            output[b.outputIndex] = messageItem(b.itemId, b.buf);
          }
          yield emit("response.output_item.done", { output_index: b.outputIndex, item: output[b.outputIndex] });
          break;
        }
        case "message_delta":
          if (ev.stopReason) stopReason = ev.stopReason;
          if (ev.usage?.inputTokens !== undefined) usage.inputTokens = ev.usage.inputTokens;
          if (ev.usage?.outputTokens !== undefined) usage.outputTokens = ev.usage.outputTokens;
          break;
        case "message_stop": {
          const incomplete = stopReason === "max_tokens";
          const r = responseObject({
            id: respId,
            model: ctx.model,
            status: incomplete ? "incomplete" : "completed",
            output: output.filter((o) => Object.keys(o).length > 0),
            usage,
            stop: stopReason,
          });
          yield emit(incomplete ? "response.incomplete" : "response.completed", { response: r });
          break;
        }
      }
    }
  },

  streamError(message) {
    return [sse({ type: "error", code: "server_error", message, param: null, sequence_number: 0 }, "error")];
  },
};
