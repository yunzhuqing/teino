/**
 * 网关中间表示（IR），以 Anthropic Messages 的 block 模型为蓝本。
 *
 * 请求协议 → IR → 上游协议；响应反向。仅在请求协议与上游协议不一致时使用，
 * 同协议请求仍走字节级透传。本模块无运行时依赖，可直接单测。
 */

export type IrImageSource = { type: "base64"; mediaType: string; data: string } | { type: "url"; url: string };

export type IrPart =
  | { type: "text"; text: string }
  | { type: "image"; source: IrImageSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: IrPart[]; isError?: boolean }
  /** 推理内容：跨协议时丢弃（签名 / 加密内容无法在协议间搬运） */
  | { type: "reasoning"; text: string };

export interface IrMessage {
  role: "user" | "assistant";
  content: IrPart[];
}

export interface IrTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export type IrToolChoice = { type: "auto" | "none" | "required" } | { type: "tool"; name: string };

export interface IrRequest {
  system: IrPart[];
  messages: IrMessage[];
  tools: IrTool[];
  toolChoice?: IrToolChoice;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences: string[];
  stream: boolean;
}

export type IrStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";

export interface IrUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface IrResponse {
  id?: string;
  model?: string;
  stopReason: IrStopReason;
  content: IrPart[];
  usage: IrUsage;
}

export type IrStreamEvent =
  | { type: "message_start"; id?: string; usage?: IrUsage }
  /** tool_use 的 input 在此处为空对象，参数通过 json_delta 增量给出 */
  | { type: "block_start"; index: number; part: IrPart }
  | { type: "text_delta"; index: number; text: string }
  | { type: "json_delta"; index: number; partialJson: string }
  | { type: "reasoning_delta"; index: number; text: string }
  | { type: "block_stop"; index: number }
  | { type: "message_delta"; stopReason?: IrStopReason; usage?: IrUsage }
  | { type: "message_stop" };

/** 请求包含无法跨协议表达的字段：网关直接返回 400，不尝试上游 */
export class UnsupportedFieldError extends Error {
  constructor(public readonly field: string, detail?: string) {
    super(`跨协议调用不支持字段 "${field}"${detail ? `：${detail}` : ""}`);
    this.name = "UnsupportedFieldError";
  }
}

/** 请求结构不合法（类型错误、缺字段等） */
export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

// ---------- 通用小工具（各 codec 共用） ----------

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** 字段存在且不是 null / undefined */
export function present(o: Obj, key: string): boolean {
  return o[key] !== undefined && o[key] !== null;
}

/** 解析工具参数 JSON 字符串；空串视为 {} */
export function parseToolArguments(raw: unknown, where: string): unknown {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new InvalidRequestError(`${where} 不是合法的 JSON：${raw.slice(0, 100)}`);
  }
}

export function textOf(parts: readonly IrPart[]): string {
  return parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** 合并相邻同角色消息（Anthropic 要求 user / assistant 交替） */
export function mergeAdjacent(messages: IrMessage[]): IrMessage[] {
  const out: IrMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...m.content);
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

let idCounter = 0;
export function genId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
