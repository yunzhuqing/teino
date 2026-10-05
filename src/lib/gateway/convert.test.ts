import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUpstreamRequest, convertErrorBody, convertResponse, convertStream, parseClientRequest } from "./convert";
import { UnsupportedFieldError, type Obj } from "./ir";
import { formatSse, parseSseStream, type SseEvent } from "./sse";

const weatherTool = { type: "object", properties: { city: { type: "string" } }, required: ["city"] };

function streamOf(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, (i += chunkSize)));
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of parseSseStream(stream)) out.push(ev);
  return out;
}

const json = (evs: SseEvent[]) => evs.filter((e) => e.data !== "[DONE]").map((e) => JSON.parse(e.data) as Obj);

test("SSE：跨 chunk 边界、多行 data、注释与 CRLF", async () => {
  const raw = ": ping\r\nevent: a\r\ndata: {\"x\":\r\ndata: 1}\r\n\r\ndata: [DONE]\n\n";
  const evs = await collect(streamOf(raw, 3));
  assert.deepEqual(evs, [{ event: "a", data: '{"x":\n1}' }, { event: undefined, data: "[DONE]" }]);
});

test("请求：Responses → Anthropic，工具调用参数字符串转对象，max_tokens 兜底", () => {
  const ir = parseClientRequest("openai_responses", {
    model: "claude-opus-5-5",
    instructions: "你是助手",
    input: [
      { role: "user", content: "北京天气？" },
      { type: "function_call", call_id: "call_1", name: "weather", arguments: '{"city":"北京"}' },
      { type: "function_call_output", call_id: "call_1", output: "晴 25℃" },
    ],
    tools: [{ type: "function", name: "weather", description: "查天气", parameters: weatherTool }],
    tool_choice: "required",
    store: false,
  });
  const out = buildUpstreamRequest("anthropic_messages", ir, "claude-opus-5-5-20261001", 4096);
  assert.deepEqual(out, {
    model: "claude-opus-5-5-20261001",
    max_tokens: 4096,
    system: [{ type: "text", text: "你是助手" }],
    messages: [
      { role: "user", content: [{ type: "text", text: "北京天气？" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "weather", input: { city: "北京" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "晴 25℃" }] }] },
    ],
    tools: [{ name: "weather", description: "查天气", input_schema: weatherTool }],
    tool_choice: { type: "any" },
  });
});

test("请求：Chat → Anthropic，system 提取、tool 消息折叠进 user、stop 归一化", () => {
  const ir = parseClientRequest("openai_chat", {
    model: "m",
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "c1", content: "r1" },
      { role: "user", content: "继续" },
    ],
    stop: "END",
    max_completion_tokens: 100,
  });
  const out = buildUpstreamRequest("anthropic_messages", ir, "m", 4096);
  assert.equal(out.max_tokens, 100);
  assert.deepEqual(out.stop_sequences, ["END"]);
  // tool_result 与后续 user 文本合并为同一条 user 消息（Anthropic 要求角色交替）
  assert.deepEqual(out.messages, [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "f", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: [{ type: "text", text: "r1" }] }, { type: "text", text: "继续" }] },
  ]);
});

test("请求：Anthropic → Chat，tool_result 拆成 tool 消息并排在 user 文本之前", () => {
  const ir = parseClientRequest("anthropic_messages", {
    model: "m",
    max_tokens: 50,
    system: "S",
    messages: [
      { role: "user", content: "q" },
      { role: "assistant", content: [{ type: "thinking", thinking: "…", signature: "sig" }, { type: "tool_use", id: "t1", name: "f", input: { a: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }, { type: "text", text: "next" }] },
    ],
    stream: true,
  });
  const out = buildUpstreamRequest("openai_chat", ir, "gpt", 4096);
  assert.deepEqual(out.messages, [
    { role: "system", content: "S" },
    { role: "user", content: "q" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: '{"a":1}' } }] },
    { role: "tool", tool_call_id: "t1", content: "ok" },
    { role: "user", content: "next" },
  ]);
  assert.equal(out.max_tokens, 50);
  assert.deepEqual(out.stream_options, { include_usage: true });
});

test("请求：不支持的字段明确报错", () => {
  assert.throws(() => parseClientRequest("openai_responses", { input: "x", previous_response_id: "resp_1" }), UnsupportedFieldError);
  assert.throws(() => parseClientRequest("openai_responses", { input: "x", store: true }), /store/);
  assert.throws(() => parseClientRequest("openai_responses", { input: "x", tools: [{ type: "web_search" }] }), /web_search/);
  assert.throws(() => parseClientRequest("openai_chat", { messages: [], response_format: { type: "json_object" } }), /response_format/);
  assert.throws(() => parseClientRequest("anthropic_messages", { messages: [], top_k: 5 }), /top_k/);
  // 惰性元数据与无害 include 不报错
  parseClientRequest("openai_responses", { input: "x", store: false, user: "u", metadata: {}, include: ["reasoning.encrypted_content"] });
});

test("响应：Anthropic → Chat，工具调用与 finish_reason，推理内容被丢弃", () => {
  const out = convertResponse(
    "anthropic_messages",
    "openai_chat",
    {
      id: "msg_1",
      content: [
        { type: "thinking", thinking: "想一想", signature: "s" },
        { type: "text", text: "我来查" },
        { type: "tool_use", id: "t1", name: "weather", input: { city: "北京" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
    { model: "claude-opus-5-5", request: {} },
  );
  const choice = (out.choices as Obj[])[0];
  assert.equal(choice.finish_reason, "tool_calls");
  assert.deepEqual(choice.message, {
    role: "assistant",
    content: "我来查",
    tool_calls: [{ id: "t1", type: "function", function: { name: "weather", arguments: '{"city":"北京"}' } }],
  });
  assert.deepEqual(out.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  assert.equal(out.model, "claude-opus-5-5");
});

test("响应：Anthropic → Responses，max_tokens 映射为 incomplete", () => {
  const out = convertResponse(
    "anthropic_messages",
    "openai_responses",
    { content: [{ type: "text", text: "截断" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 2 } },
    { model: "m", request: {} },
  );
  assert.equal(out.status, "incomplete");
  assert.deepEqual(out.incomplete_details, { reason: "max_output_tokens" });
  const [msg] = out.output as Obj[];
  assert.deepEqual((msg.content as Obj[])[0], { type: "output_text", text: "截断", annotations: [] });
});

test("响应：Responses → Anthropic，function_call 的 arguments 字符串解析为对象", () => {
  const out = convertResponse(
    "openai_responses",
    "anthropic_messages",
    { status: "completed", output: [{ type: "function_call", call_id: "c9", name: "f", arguments: '{"k":"v"}' }], usage: { input_tokens: 3, output_tokens: 4 } },
    { model: "m", request: {} },
  );
  assert.equal(out.stop_reason, "tool_use");
  assert.deepEqual(out.content, [{ type: "tool_use", id: "c9", name: "f", input: { k: "v" } }]);
});

const anthropicStream = [
  { event: "message_start", data: { type: "message_start", message: { id: "msg_x", usage: { input_tokens: 12, output_tokens: 1 } } } },
  { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "嗯" } } },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  { event: "content_block_start", data: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "查" } } },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
  { event: "content_block_start", data: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "weather", input: {} } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"city":' } } },
  { event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"北京"}' } } },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
  { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } } },
  { event: "message_stop", data: { type: "message_stop" } },
]
  .map((e) => formatSse({ event: e.event, data: JSON.stringify(e.data) }))
  .join("");

test("流式：Anthropic → Chat，工具参数增量、finish_reason、usage 与 [DONE]", async () => {
  const { stream, done } = convertStream("anthropic_messages", "openai_chat", streamOf(anthropicStream, 13), {
    model: "claude-opus-5-5",
    request: { stream_options: { include_usage: true } },
  });
  const evs = await collect(stream);
  assert.equal(evs.at(-1)?.data, "[DONE]");
  const chunks = json(evs);
  const deltas = chunks.flatMap((c) => (c.choices as Obj[]).map((ch) => ch.delta as Obj));
  assert.equal(deltas.map((d) => d.content ?? "").join(""), "查");
  const args = deltas.flatMap((d) => ((d.tool_calls as Obj[]) ?? []).map((t) => (t.function as Obj).arguments)).join("");
  assert.deepEqual(JSON.parse(args), { city: "北京" });
  const finish = chunks.flatMap((c) => (c.choices as Obj[]).map((ch) => ch.finish_reason)).filter(Boolean);
  assert.deepEqual(finish, ["tool_calls"]);
  assert.deepEqual(chunks.at(-1)?.usage, { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 });
  assert.deepEqual((await done).usage, { inputTokens: 12, outputTokens: 20 });
});

test("流式：Anthropic → Responses，事件序列、sequence_number 递增、最终 output", async () => {
  const { stream } = convertStream("anthropic_messages", "openai_responses", streamOf(anthropicStream), { model: "m", request: {} });
  const evs = await collect(stream);
  const data = json(evs);
  assert.deepEqual(
    evs.map((e) => e.event),
    [
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ],
  );
  assert.deepEqual(data.map((d) => d.sequence_number), data.map((_, i) => i));
  const final = data.at(-1)!.response as Obj;
  const [msg, fc] = final.output as Obj[];
  assert.equal(msg.type, "message");
  assert.deepEqual({ type: fc.type, call_id: fc.call_id, arguments: fc.arguments }, { type: "function_call", call_id: "t1", arguments: '{"city":"北京"}' });
});

test("流式：Chat → Anthropic，index 连续、tool_use 起止完整", async () => {
  const chunks = [
    { id: "c", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
    { id: "c", choices: [{ index: 0, delta: { content: "好" } }] },
    { id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "f", arguments: '{"x"' } }] } }] },
    { id: "c", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } }] },
    { id: "c", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    { id: "c", choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
  ];
  const raw = chunks.map((c) => formatSse({ data: JSON.stringify(c) })).join("") + "data: [DONE]\n\n";
  const { stream, done } = convertStream("openai_chat", "anthropic_messages", streamOf(raw), { model: "m", request: {} });
  const data = json(await collect(stream));
  assert.deepEqual(
    data.map((d) => `${d.type}${d.index === undefined ? "" : `#${d.index}`}`),
    [
      "message_start",
      "content_block_start#0",
      "content_block_delta#0",
      "content_block_stop#0",
      "content_block_start#1",
      "content_block_delta#1",
      "content_block_delta#1",
      "content_block_stop#1",
      "message_delta",
      "message_stop",
    ],
  );
  assert.deepEqual(data[4].content_block, { type: "tool_use", id: "call_a", name: "f", input: {} });
  assert.deepEqual(data[8].delta, { stop_reason: "tool_use", stop_sequence: null });
  assert.deepEqual((await done).usage, { inputTokens: 7, outputTokens: 3 });
});

test("流式：上游中途报错时输出客户端协议的错误帧", async () => {
  const raw =
    formatSse({ event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_1", usage: {} } }) }) +
    formatSse({ event: "error", data: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) });
  const { stream, done } = convertStream("anthropic_messages", "openai_chat", streamOf(raw), { model: "m", request: {} });
  const evs = await collect(stream);
  assert.deepEqual(json(evs).at(-1), { error: { message: "Overloaded", type: "server_error", code: 502 } });
  assert.equal((await done).error, "Overloaded");
});

test("错误：上游错误体改写为客户端协议信封", () => {
  const body = convertErrorBody("openai_chat", 400, JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }));
  assert.deepEqual(JSON.parse(body), { error: { message: "bad", type: "invalid_request_error", code: 400 } });
});
