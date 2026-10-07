import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeError } from "./sanitize";

test("上游错误只保留状态码，隐藏供应商名与响应体", () => {
  const raw = "OpenAI-主力: HTTP 429 {\"error\":{\"message\":\"Rate limit for org-abc123\"}}\nAzure: fetch failed";
  assert.equal(sanitizeError(raw, ["OpenAI-主力", "Azure"]), "上游返回 HTTP 429\n上游调用失败");
});

test("网关自身的提示原样保留", () => {
  const raw = "积分余额不足：当前 0.5，本次预计消耗 1.2";
  assert.equal(sanitizeError(raw, ["OpenAI"]), raw);
});
