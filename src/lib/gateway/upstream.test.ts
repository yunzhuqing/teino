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

test("errorBody 与重试判定", () => {
  assert.equal(JSON.parse(errorBody("anthropic_messages", 401, "x")).error.type, "authentication_error");
  assert.equal(JSON.parse(errorBody("openai_chat", 404, "x")).error.message, "x");
  assert.ok(isRetryableStatus(429) && isRetryableStatus(503));
  assert.ok(!isRetryableStatus(400) && !isRetryableStatus(401));
});
