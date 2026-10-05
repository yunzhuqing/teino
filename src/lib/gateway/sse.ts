/** SSE 帧解析与序列化（用于跨协议流式转换；同协议仍走 tapSseUsage 字节透传） */

export interface SseEvent {
  event?: string;
  data: string;
}

/** 按 SSE 规范解析：空行分帧，多行 data 以 \n 连接，忽略注释行与 id/retry */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];

  const flush = (): SseEvent | null => {
    const out = data.length ? { event, data: data.join("\n") } : null;
    event = undefined;
    data = [];
    return out;
  };

  const handleLine = (line: string): SseEvent | null => {
    if (line === "") return flush();
    if (line.startsWith(":")) return null;
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? "" : line.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) !== -1) {
        // 末尾的 \r 可能是被 chunk 切开的 \r\n，等下一段数据再判断
        if (buffer[nl] === "\r" && nl === buffer.length - 1) break;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + (buffer[nl] === "\r" && buffer[nl + 1] === "\n" ? 2 : 1));
        const ev = handleLine(line);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const ev = handleLine(buffer);
      if (ev) yield ev;
    }
    const last = flush();
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

export function formatSse(ev: SseEvent): string {
  const head = ev.event ? `event: ${ev.event}\n` : "";
  return head + ev.data.split("\n").map((l) => `data: ${l}`).join("\n") + "\n\n";
}

/** 将事件序列序列化为字节流；下游取消时同步结束上游迭代 */
export function serializeSse(events: AsyncIterable<SseEvent>, onEnd?: (err?: unknown) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  let ended = false;
  const end = (err?: unknown) => {
    if (ended) return;
    ended = true;
    onEnd?.(err);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) {
          end();
          controller.close();
        } else {
          controller.enqueue(encoder.encode(formatSse(value)));
        }
      } catch (err) {
        end(err);
        controller.error(err);
      }
    },
    async cancel(reason) {
      end(reason);
      await it.return?.();
    },
  });
}
