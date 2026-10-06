import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamHeaders, buildUpstreamUrl, errorBody, isRetryableStatus, mergeUsage, tapSseUsage, type Usage } from "./upstream";

test("buildUpstreamUrl 拼接路径并去除多余斜杠", () => {
  assert.equal(buildUpstreamUrl("https://api.openai.com/v1/", "openai_chat"), "https://api.openai.com/v1/chat/completions");
  assert.equal(buildUpstreamUrl("https://api.openai.com/v1", "openai_responses"), "https://api.openai.com/v1/responses");
  assert.equal(buildUpstreamUrl("https://api.anthropic.com/v1", "anthropic_messages"), "https://api.anthropic.com/v1/messages");
});

test("buildUpstreamHeaders 按协议设置鉴权头，且不透传调用方的 Key", () => {
  const incoming = new Headers({ authorization: "Bearer client-key", "anthropic-beta": "x" });
  const oa = buildUpstreamHeaders("openai_chat", "up-key", incoming, { "X-Org": "o1" });
  assert.equal(oa.get("authorization"), "Bearer up-key");
  assert.equal(oa.get("x-org"), "o1");

  const an = buildUpstreamHeaders("anthropic_messages", "up-key", incoming, {});
  assert.equal(an.get("x-api-key"), "up-key");
  assert.equal(an.get("authorization"), null);
  assert.equal(an.get("anthropic-version"), "2023-06-01");
  assert.equal(an.get("anthropic-beta"), "x");
});

test("mergeUsage 兼容三种协议", () => {
  const a: Usage = {};
  mergeUsage(a, { usage: { prompt_tokens: 10, completion_tokens: 5 } });
  assert.deepEqual(a, { inputTokens: 10, outputTokens: 5 });

  const b: Usage = {};
  mergeUsage(b, { type: "response.completed", response: { usage: { input_tokens: 7, output_tokens: 3 } } });
  assert.deepEqual(b, { inputTokens: 7, outputTokens: 3 });

  const c: Usage = {};
  mergeUsage(c, { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } });
  mergeUsage(c, { type: "message_delta", usage: { output_tokens: 42 } });
  assert.deepEqual(c, { inputTokens: 12, outputTokens: 42 });
});

test("tapSseUsage 透传原始字节并解析跨 chunk 的 usage", async () => {
  const enc = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_',
    'tokens":3,"completion_tokens":9}}\n\ndata: [DONE]\n\n',
  ];
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  const { stream, done } = tapSseUsage(src);
  const text = await new Response(stream).text();
  assert.equal(text, chunks.join(""));
  assert.deepEqual(await done, { inputTokens: 3, outputTokens: 9 });
});

test("mergeUsage 拆出 Anthropic 的缓存命中与写入，不再并入 inputTokens", () => {
  const a: Usage = {};
  mergeUsage(a, {
    type: "message_start",
    message: { usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } },
  });
  assert.deepEqual(a, { inputTokens: 100, outputTokens: 1, cacheReadTokens: 900, cacheWriteTokens: 50 });
});

test("mergeUsage 支持 cache_creation_input_tokens 的分层对象形状", () => {
  const a: Usage = {};
  mergeUsage(a, {
    message: { usage: { input_tokens: 10, cache_creation_input_tokens: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 } } },
  });
  assert.equal(a.cacheWriteTokens, 500);
});

test("mergeUsage 从 OpenAI 的 prompt_tokens 中减出命中缓存的部分", () => {
  const a: Usage = {};
  mergeUsage(a, { usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 800 } } });
  // 否则命中部分会既按输入价又按缓存价各计一次
  assert.deepEqual(a, { inputTokens: 200, outputTokens: 20, cacheReadTokens: 800 });
});

test("mergeUsage 从 Responses 的 input_tokens_details 中减出命中缓存", () => {
  const a: Usage = {};
  mergeUsage(a, { type: "response.completed", response: { usage: { input_tokens: 500, output_tokens: 30, input_tokens_details: { cached_tokens: 400 } } } });
  assert.equal(a.inputTokens, 100);
  assert.equal(a.cacheReadTokens, 400);
});

test("mergeUsage 命中数大于总量时不产生负输入", () => {
  const a: Usage = {};
  mergeUsage(a, { usage: { prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 150 } } });
  assert.equal(a.inputTokens, 0);
});

test("mergeUsage 的缓存字段一旦拿到就锁定，不被后续 0 覆盖", () => {
  const a: Usage = {};
  mergeUsage(a, { message: { usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } } });
  // 上游常在后续事件里重复上报 usage，此时缓存字段可能缺失或为 0
  mergeUsage(a, { type: "message_delta", usage: { output_tokens: 42, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
  assert.equal(a.cacheReadTokens, 900, "缓存命中数不应被清零");
  assert.equal(a.cacheWriteTokens, 50, "缓存写入数不应被清零");
  assert.equal(a.outputTokens, 42);
});

test("mergeUsage 对没有缓存概念的上游不写入缓存字段", () => {
  const a: Usage = {};
  mergeUsage(a, { usage: { prompt_tokens: 10, completion_tokens: 5 } });
  assert.equal(a.cacheReadTokens, undefined);
  assert.equal(a.cacheWriteTokens, undefined);
});

test("tapSseUsage 解析跨 chunk 的 Anthropic 缓存字段", async () => {
  const enc = new TextEncoder();
  const chunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_inp',
    'ut_tokens":800,"cache_creation_input_tokens":40}}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n',
  ];
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  const { stream, done } = tapSseUsage(src);
  const text = await new Response(stream).text();
  assert.equal(text, chunks.join(""));
  assert.deepEqual(await done, { inputTokens: 12, outputTokens: 7, cacheReadTokens: 800, cacheWriteTokens: 40 });
});

test("tapSseUsage 在流被客户端取消时也 resolve 已累积的 usage", async () => {
  const enc = new TextEncoder();
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('data: {"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n'));
      // 故意不 close：模拟上游迟迟不结束
    },
  });
  const { stream, done } = tapSseUsage(src);
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  const usage = await done;
  assert.equal(usage.inputTokens, 5);
});

test("errorBody 与重试判定", () => {
  assert.equal(JSON.parse(errorBody("anthropic_messages", 401, "x")).error.type, "authentication_error");
  assert.equal(JSON.parse(errorBody("openai_chat", 404, "x")).error.message, "x");
  assert.ok(isRetryableStatus(429) && isRetryableStatus(503));
  assert.ok(!isRetryableStatus(400) && !isRetryableStatus(401));
});

test("errorBody 对 402 给出可被客户端识别的错误类型", () => {
  assert.equal(JSON.parse(errorBody("anthropic_messages", 402, "积分余额不足")).error.message, "积分余额不足");
  assert.equal(JSON.parse(errorBody("openai_chat", 402, "积分余额不足")).error.code, 402);
});
