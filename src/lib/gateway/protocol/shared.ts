import type { IrImageSource, IrRequest, IrResponse, IrStreamEvent, Obj } from "../ir";
import { isObj, str } from "../ir";
import type { SseEvent } from "../sse";

export interface EncodeContext {
  /** 返回给客户端的模型名（对外名） */
  model: string;
  /** 客户端原始请求体（编码器可读取 stream_options 等选项） */
  request: Obj;
}

/** 单个协议的编解码器：协议 ⇄ IR */
export interface Codec {
  parseRequest(body: Obj): IrRequest;
  buildRequest(ir: IrRequest, model: string): Obj;
  parseResponse(body: unknown): IrResponse;
  buildResponse(ir: IrResponse, ctx: EncodeContext): Obj;
  decodeStream(events: AsyncIterable<SseEvent>): AsyncGenerator<IrStreamEvent>;
  encodeStream(events: AsyncIterable<IrStreamEvent>, ctx: EncodeContext): AsyncGenerator<SseEvent>;
  /** 流式过程中出错时发给客户端的协议原生错误帧 */
  streamError(message: string): SseEvent[];
}

/** 上游在 SSE 流中途返回错误事件 */
export class UpstreamStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamStreamError";
  }
}

/** 从任意协议的错误体中提取 message */
export function extractErrorMessage(body: unknown): string | undefined {
  if (!isObj(body)) return undefined;
  const err = body.error;
  if (typeof err === "string") return err;
  if (isObj(err)) return str(err.message);
  return str(body.message);
}

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

export function imageFromUrl(url: string): IrImageSource {
  const m = DATA_URL.exec(url);
  return m ? { type: "base64", mediaType: m[1], data: m[2] } : { type: "url", url };
}

export function imageToUrl(src: IrImageSource): string {
  return src.type === "base64" ? `data:${src.mediaType};base64,${src.data}` : src.url;
}

export function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function sse(data: unknown, event?: string): SseEvent {
  return { event, data: JSON.stringify(data) };
}
