import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCandidates, planRoute, trafficShares, weightedShuffle, type RouteCandidate } from "./routing";

function cand(id: string, opts: Partial<RouteCandidate> & { providerTags?: string[]; apiTypes?: RouteCandidate["provider"]["apiTypes"]; providerEnabled?: boolean } = {}): RouteCandidate {
  return {
    modelId: id,
    modelName: opts.modelName ?? "gpt-4o",
    upstreamModel: opts.upstreamModel ?? "gpt-4o",
    priority: opts.priority ?? 0,
    weight: opts.weight ?? 100,
    modelEnabled: opts.modelEnabled ?? true,
    modelTagIds: opts.modelTagIds ?? [],
    provider: {
      id: `p-${id}`,
      name: `P ${id}`,
      enabled: opts.providerEnabled ?? true,
      apiTypes: opts.apiTypes ?? ["openai_chat"],
      tagIds: opts.providerTags ?? [],
    },
  };
}

const base = { model: "gpt-4o", apiType: "openai_chat" as const, callerTagIds: [] };

test("过滤：模型名、启用状态、API 类型", () => {
  const list = [
    cand("a"),
    cand("b", { modelName: "other" }),
    cand("c", { modelEnabled: false }),
    cand("d", { providerEnabled: false }),
    cand("e", { apiTypes: ["anthropic_messages"] }),
  ];
  assert.deepEqual(filterCandidates(list, base).map((c) => c.modelId), ["a"]);
});

test("标签：调用方标签需与供应商或模型标签有交集", () => {
  const list = [cand("a", { providerTags: ["vip"] }), cand("b", { modelTagIds: ["free"] }), cand("c")];
  assert.deepEqual(filterCandidates(list, { ...base, callerTagIds: ["vip"] }).map((c) => c.modelId), ["a"]);
  assert.deepEqual(filterCandidates(list, { ...base, callerTagIds: ["free", "vip"] }).map((c) => c.modelId), ["a", "b"]);
  assert.equal(filterCandidates(list, base).length, 3);
});

test("标签：请求头要求的标签必须全部满足", () => {
  const list = [cand("a", { providerTags: ["cn"], modelTagIds: ["fast"] }), cand("b", { providerTags: ["cn"] })];
  assert.deepEqual(filterCandidates(list, { ...base, requiredTagIds: ["cn", "fast"] }).map((c) => c.modelId), ["a"]);
});

test("优先级：高优先级层排在前面", () => {
  const list = [cand("low", { priority: 1 }), cand("high", { priority: 10 }), cand("mid", { priority: 5 })];
  assert.deepEqual(planRoute(list, base).map((c) => c.modelId), ["high", "mid", "low"]);
});

test("流量配比：加权随机分布接近权重比例", () => {
  const items = [{ id: "a", weight: 70 }, { id: "b", weight: 20 }, { id: "c", weight: 10 }, { id: "z", weight: 0 }];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const counts: Record<string, number> = { a: 0, b: 0, c: 0, z: 0 };
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const order = weightedShuffle(items, rand);
    counts[order[0].id]++;
    assert.equal(order.length, 4);
    assert.equal(order[3].id, "z");
  }
  assert.ok(Math.abs(counts.a / N - 0.7) < 0.02);
  assert.ok(Math.abs(counts.b / N - 0.2) < 0.02);
  assert.ok(Math.abs(counts.c / N - 0.1) < 0.02);
  assert.equal(counts.z, 0);
});

test("trafficShares：按优先级层内计算占比", () => {
  const a = { priority: 1, weight: 30 };
  const b = { priority: 1, weight: 10 };
  const c = { priority: 0, weight: 5 };
  const s = trafficShares([a, b, c]);
  assert.equal(s.get(a), 0.75);
  assert.equal(s.get(b), 0.25);
  assert.equal(s.get(c), 1);
});
