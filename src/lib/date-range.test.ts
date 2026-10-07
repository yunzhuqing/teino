import assert from "node:assert/strict";
import { test } from "node:test";
import { localDate, parseDateRange } from "./date-range";

const now = new Date("2026-10-07T18:30:00Z"); // 北京时间 10-08 02:30

test("缺省时取最近 N 天（按北京时间算今天）", () => {
  const r = parseDateRange({}, 7, now);
  assert.equal(r.to, "2026-10-08");
  assert.equal(r.from, "2026-10-02");
  assert.equal(r.start.toISOString(), "2026-10-01T16:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-08T16:00:00.000Z");
});

test("两端包含整天，颠倒时交换", () => {
  const r = parseDateRange({ from: "2026-10-05", to: "2026-10-01" }, 7, now);
  assert.equal(r.from, "2026-10-01");
  assert.equal(r.to, "2026-10-05");
  assert.equal(r.end.getTime() - r.start.getTime(), 5 * 24 * 3600 * 1000);
});

test("非法日期回退为默认值", () => {
  const r = parseDateRange({ from: "abc", to: "2026-13-45" }, 1, now);
  assert.equal(r.from, "2026-10-08");
  assert.equal(r.to, "2026-10-08");
});

test("localDate 按东八区换日", () => {
  assert.equal(localDate(new Date("2026-10-07T15:59:59Z")), "2026-10-07");
  assert.equal(localDate(new Date("2026-10-07T16:00:00Z")), "2026-10-08");
});
