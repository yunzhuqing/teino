import test from "node:test";
import assert from "node:assert/strict";
import { estimateInputTokens, estimateOutputTokens } from "./estimate";

test("estimateInputTokens 空请求体返回固定开销", () => {
  const n = estimateInputTokens({});
  assert.equal(n, 8);
});

test("estimateInputTokens 随文本长度单调增长", () => {
  const short = estimateInputTokens({ messages: [{ role: "user", content: "hello" }] });
  const long = estimateInputTokens({ messages: [{ role: "user", content: "hello".repeat(1000) }] });
  // 文本量增长 1000 倍，估算值应至少增长 50 倍（固定开销会稀释倍数）
  assert.ok(long > short * 50, `期望长文本显著更大：${long} vs ${short}`);
});

test("estimateInputTokens 覆盖 Anthropic 的 system 字段", () => {
  const withSystem = estimateInputTokens({ system: "x".repeat(350), messages: [] });
  const without = estimateInputTokens({ messages: [] });
  assert.ok(withSystem > without, "system 内容应计入估算");
});

test("estimateInputTokens 覆盖 Responses 的 input 字段", () => {
  const a = estimateInputTokens({ input: "y".repeat(350) });
  const b = estimateInputTokens({});
  assert.ok(a > b, "Responses 的 input 内容应计入估算");
});

test("estimateInputTokens 对同一输入是确定性的", () => {
  const body = { system: "sys", messages: [{ role: "user", content: [{ type: "text", text: "abc" }] }], tools: [{ name: "t", description: "d" }] };
  assert.equal(estimateInputTokens(body), estimateInputTokens(body));
});

test("estimateInputTokens 计入图片的固定开销", () => {
  const withImage = estimateInputTokens({
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: "x" } }] }],
  });
  const textOnly = estimateInputTokens({ messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] });
  assert.ok(withImage > textOnly + 1000, `图片应有约千级 token 的开销：${withImage} vs ${textOnly}`);
});

test("estimateInputTokens 至少返回 1，避免零值影响档位判定", () => {
  assert.ok(estimateInputTokens({ messages: [] }) >= 1);
});

test("estimateOutputTokens 优先采用调用方声明的上限", () => {
  assert.equal(estimateOutputTokens({ max_tokens: 1000 }, 4096), 1000);
  assert.equal(estimateOutputTokens({ max_completion_tokens: 512 }, 4096), 512);
  assert.equal(estimateOutputTokens({ max_output_tokens: 256 }, 4096), 256);
});

test("estimateOutputTokens 未声明时用兜底值", () => {
  assert.equal(estimateOutputTokens({}, 4096), 4096);
  assert.equal(estimateOutputTokens({ max_tokens: 0 }, 2048), 2048);
  assert.equal(estimateOutputTokens({ max_tokens: "1000" }, 4096), 4096, "非数字声明应回退到默认值");
});
