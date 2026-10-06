import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PERIOD, BREAKDOWN_LABELS, computeCost, estimateCredits, resolveMultiplier, selectPeriod, selectTier, settle, toBase, type PriceTier } from "./pricing";
import { applyMultiplier, parseCredit, parseMultiplier } from "./money";

/** 复刻用户给的样例：gpt-6.1-sol 两档价格 */
function tier(over: Partial<PriceTier>): PriceTier {
  return {
    id: over.id ?? "t1",
    modelId: "m1",
    contextMin: 0,
    contextMax: null,
    period: ALL_PERIOD,
    inputPrice: "2",
    outputPrice: "10",
    cacheWritePrice: "2.5",
    cacheReadPrice: "0.1",
    ...over,
  };
}

const TIERS: PriceTier[] = [
  tier({ id: "small", contextMin: 0, contextMax: 272_000 }),
  tier({ id: "large", contextMin: 272_000, contextMax: 1_000_000, inputPrice: "4", outputPrice: "15", cacheWritePrice: "5", cacheReadPrice: "0.2" }),
];

test("selectTier 区间为闭开区间，恰好落在边界上归入上一档", () => {
  assert.equal(selectTier(TIERS, 0, ALL_PERIOD)?.id, "small");
  assert.equal(selectTier(TIERS, 271_999, ALL_PERIOD)?.id, "small");
  // 272000 是 small 的上界，不含；是 large 的下界，含
  assert.equal(selectTier(TIERS, 272_000, ALL_PERIOD)?.id, "large");
  assert.equal(selectTier(TIERS, 999_999, ALL_PERIOD)?.id, "large");
});

test("selectTier 超出所有区间时返回 null 而不是静默按 0 计费", () => {
  assert.equal(selectTier(TIERS, 1_000_000, ALL_PERIOD), null);
  assert.equal(selectTier(TIERS, 5_000_000, ALL_PERIOD), null);
});

test("selectTier 在 overflow 模式下退回最贵的档，避免运营漏配导致白送", () => {
  // 超出 1M 上限 → 退回起点最大的档
  assert.equal(selectTier(TIERS, 5_000_000, ALL_PERIOD, true)?.id, "large");
  // 时段内没有可用档时也不能返回 null
  const onlyPeriod = [tier({ id: "peak", period: "peak" })];
  assert.equal(selectTier(onlyPeriod, 100, "off-peak", true)?.id, "peak");
  // 完全没有档位配置时仍然返回 null（无从计起）
  assert.equal(selectTier([], 100, ALL_PERIOD, true), null);
});

test("selectTier 无上限档覆盖任意大上下文", () => {
  const open = [tier({ id: "flat", contextMin: 0, contextMax: null })];
  assert.equal(selectTier(open, 10_000_000, ALL_PERIOD)?.id, "flat");
});

test("selectTier 优先命中具体时段，缺失时回落到 all 兜底档", () => {
  const withPeriods = [
    tier({ id: "peak", period: "peak", inputPrice: "9" }),
    tier({ id: "fallback", period: ALL_PERIOD, inputPrice: "3" }),
  ];
  assert.equal(selectTier(withPeriods, 100, "peak")?.id, "peak");
  // 请求时段是 off-peak，没有对应档 → 回落 all
  assert.equal(selectTier(withPeriods, 100, "off-peak")?.id, "fallback");
});

test("selectTier 时段有档但上下文区间不匹配时，仍可回落到 all 档", () => {
  const mixed = [
    tier({ id: "peak-small", period: "peak", contextMin: 0, contextMax: 1000 }),
    tier({ id: "fallback", period: ALL_PERIOD, contextMin: 0, contextMax: null }),
  ];
  assert.equal(selectTier(mixed, 5000, "peak")?.id, "fallback");
});

test("selectPeriod 命中时段窗口，都不命中回落 all", () => {
  const windows = [{ name: "peak", startMinute: 9 * 60, endMinute: 18 * 60, timezone: "UTC" }];
  assert.equal(selectPeriod(windows, new Date("2026-01-05T10:00:00Z")), "peak");
  assert.equal(selectPeriod(windows, new Date("2026-01-05T23:00:00Z")), ALL_PERIOD);
});

test("selectPeriod 窗口含起点不含终点", () => {
  const windows = [{ name: "peak", startMinute: 540, endMinute: 1080, timezone: "UTC" }];
  assert.equal(selectPeriod(windows, new Date("2026-01-05T09:00:00Z")), "peak");
  assert.equal(selectPeriod(windows, new Date("2026-01-05T18:00:00Z")), ALL_PERIOD);
});

test("selectPeriod 支持跨午夜时段", () => {
  const windows = [{ name: "night", startMinute: 22 * 60, endMinute: 6 * 60, timezone: "UTC" }];
  assert.equal(selectPeriod(windows, new Date("2026-01-05T23:30:00Z")), "night");
  assert.equal(selectPeriod(windows, new Date("2026-01-05T03:00:00Z")), "night");
  assert.equal(selectPeriod(windows, new Date("2026-01-05T12:00:00Z")), ALL_PERIOD);
});

test("selectPeriod 按时区判定，不同时段可各自声明时区", () => {
  // 上海 9:00 = UTC 01:00
  const windows = [{ name: "cn-morning", startMinute: 9 * 60, endMinute: 12 * 60, timezone: "Asia/Shanghai" }];
  assert.equal(selectPeriod(windows, new Date("2026-01-05T01:30:00Z")), "cn-morning");
  assert.equal(selectPeriod(windows, new Date("2026-01-05T09:30:00Z")), ALL_PERIOD);
});

test("selectPeriod 无时段配置时回落 all", () => {
  assert.equal(selectPeriod([], new Date()), ALL_PERIOD);
});

test("resolveMultiplier 未声明的档位按 1 计", () => {
  assert.equal(resolveMultiplier({ standard: 1, priority: 2 }), 10_000n);
  assert.equal(resolveMultiplier({ standard: 1, priority: 2 }, "priority"), parseMultiplier(2));
  assert.equal(resolveMultiplier({ standard: 1 }, "batch"), 10_000n);
  assert.equal(resolveMultiplier({ batch: 0.5 }, "batch"), parseMultiplier(0.5));
});

test("computeCost 按四个维度分别计费后求和", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 100_000,
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  // 输入 2 + 输出 1 + 缓存写 2.5 + 缓存读 0.1 = 5.6
  assert.equal(r.amountOriginal, "5.60000000");
  assert.equal(r.tierId, "small");
  assert.equal(r.breakdown.length, 4);
  assert.equal(r.multiplier, 1);
});

test("computeCost 命中更大上下文档时换用高价位", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 300_000,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  assert.equal(r.tierId, "large");
  assert.equal(r.amountOriginal, "4.00000000");
});

test("computeCost 缓存命中不重复计入输入", () => {
  const withCache = computeCost({
    tiers: TIERS,
    contextTokens: 1000,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  // 只有缓存读按 0.1/M 计费
  assert.equal(withCache.amountOriginal, "0.10000000");

  const asInput = computeCost({
    tiers: TIERS,
    contextTokens: 1000,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  assert.equal(asInput.amountOriginal, "2.00000000");
});

test("computeCost 缓存单价为 0 时该维度不计费", () => {
  const free = [tier({ id: "free-cache", cacheReadPrice: "0", cacheWritePrice: "0" })];
  const r = computeCost({
    tiers: free,
    contextTokens: 100,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  assert.equal(r.amountOriginal, "0.00000000");
});

test("computeCost 倍率乘在合计之后", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 1000,
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityTier: "priority",
    priorityMultipliers: { priority: 2 },
    period: ALL_PERIOD,
  })!;
  assert.equal(r.amountOriginal, "4.00000000");
  assert.equal(r.multiplier, 2);
  assert.equal(r.priorityTier, "priority");
});

test("computeCost 零用量计费为 0", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  assert.equal(r.amountOriginal, "0.00000000");
});

test("computeCost 无匹配档位返回 null", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 2_000_000,
    inputTokens: 1000,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  });
  assert.equal(r, null);
});

test("computeCost 在 overflow 模式下按最贵档兜底并标记 overflowed", () => {
  const r = computeCost(
    {
      tiers: TIERS,
      contextTokens: 2_000_000,
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      priorityMultipliers: {},
      period: ALL_PERIOD,
    },
    true,
  )!;
  assert.equal(r.tierId, "large");
  assert.equal(r.overflowed, true);
  // 大档输入价 $4/M
  assert.equal(r.amountOriginal, "4.00000000");
});

test("computeCost 正常命中档位时 overflowed 为 false", () => {
  const r = computeCost(
    {
      tiers: TIERS,
      contextTokens: 100_000,
      inputTokens: 100_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      priorityMultipliers: {},
      period: ALL_PERIOD,
    },
    true,
  )!;
  assert.equal(r.overflowed, false);
});

const CURRENCIES = [
  { code: "USD", rateToBase: "1", isBase: true, creditRate: "100" },
  { code: "CNY", rateToBase: "0.14", isBase: false, creditRate: null },
];

test("settle 在 credit 模式下价格数字即积分", () => {
  // 价格数字 5.6 元标度（1e-8）→ 5.6 积分
  const s = settle({ mode: "credit", amountScaled: 560_000_000n, currencies: CURRENCIES })!;
  assert.equal(s.credits, parseCredit("5.6"));
  assert.equal(s.currency, null);
});

test("settle 在 token 模式下先折主货币再换积分", () => {
  const usd = settle({ mode: "token", amountScaled: 200_000_000n, currency: "USD", currencies: CURRENCIES })!;
  assert.equal(usd.credits, parseCredit("200"));
  // 100 CNY × 0.14 = 14 USD × 100 积分/USD = 1400 积分
  const cny = settle({ mode: "token", amountScaled: 10_000_000_000n, currency: "CNY", currencies: CURRENCIES })!;
  assert.equal(cny.amountBase, 1_400_000_000n);
  assert.equal(cny.credits, parseCredit("1400"));
});

test("settle 缺汇率或未配置 creditRate 时返回 null，不静默按 0 扣费", () => {
  assert.equal(settle({ mode: "token", amountScaled: 100n, currency: "JPY", currencies: CURRENCIES }), null);
  assert.equal(settle({ mode: "token", amountScaled: 100n, currency: null, currencies: CURRENCIES }), null);
  assert.equal(settle({ mode: "token", amountScaled: 100n, currency: "USD", currencies: [] }), null);
  const noRate = [{ code: "USD", rateToBase: "1", isBase: true, creditRate: null }];
  assert.equal(settle({ mode: "token", amountScaled: 100n, currency: "USD", currencies: noRate }), null);
});

test("toBase 把原币金额折算到主货币", () => {
  assert.equal(toBase(10_000_000_000n, "CNY", CURRENCIES), 1_400_000_000n);
  assert.equal(toBase(200_000_000n, "USD", CURRENCIES), 200_000_000n);
  // 未知币种原样返回，避免展示出一个凭空的数字
  assert.equal(toBase(100n, "JPY", CURRENCIES), 100n);
});

test("estimateCredits 与正式结算走同一套计价，结果可用于余额预检", () => {
  // 估算 1M 输入 + 100k 输出，上下文合计 1.1M 会超出样例档位，所以用无上限的档
  const flat = [tier({ id: "flat", contextMin: 0, contextMax: null })];
  const credits = estimateCredits({
    tiers: flat,
    billingMode: "token",
    currency: "USD",
    priorityMultipliers: {},
    priorityTier: null,
    period: ALL_PERIOD,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    currencies: CURRENCIES,
  })!;
  // $2 + $10 = $12 → 1200 积分
  assert.equal(credits, parseCredit("1200"));
});

test("estimateCredits 按输入总量与输出量估算，超出档位时返回 null", () => {
  // 输入 1M 落在 small 档，但上下文合计（输入+输出）1.5M 已超出 small 的上界
  const credits = estimateCredits({
    tiers: TIERS,
    billingMode: "token",
    currency: "USD",
    priorityMultipliers: {},
    priorityTier: null,
    period: ALL_PERIOD,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    currencies: CURRENCIES,
  })!;
  // 上下文合计 1.5M 落在 large 档（272k-1M）之外 → 无匹配档
  assert.equal(credits, null);
});

test("estimateCredits 把缓存按新增输入估算，偏保守", () => {
  const credits = estimateCredits({
    tiers: TIERS,
    billingMode: "token",
    currency: "USD",
    priorityMultipliers: {},
    priorityTier: null,
    period: ALL_PERIOD,
    inputTokens: 100_000,
    outputTokens: 0,
    currencies: CURRENCIES,
  })!;
  // 100k 落在 small 档，输入价 $2/M；即使实际命中缓存也按输入价估，不会低估
  assert.equal(credits, parseCredit("20"));
});

test("estimateCredits 套用优先级倍率", () => {
  const credits = estimateCredits({
    tiers: TIERS,
    billingMode: "token",
    currency: "USD",
    priorityMultipliers: { priority: 3 },
    priorityTier: "priority",
    period: ALL_PERIOD,
    inputTokens: 100_000,
    outputTokens: 0,
    currencies: CURRENCIES,
  })!;
  assert.equal(credits, parseCredit("60"));
});

test("estimateCredits 无法计价时返回 null，调用方应据此放行", () => {
  const base = {
    tiers: TIERS,
    billingMode: "token" as const,
    currency: "USD",
    priorityMultipliers: {},
    priorityTier: null,
    period: ALL_PERIOD,
    inputTokens: 1000,
    outputTokens: 100,
    currencies: CURRENCIES,
  };
  // 超出所有价格档
  assert.equal(estimateCredits({ ...base, inputTokens: 5_000_000 }), null);
  // 币种没有对应汇率
  assert.equal(estimateCredits({ ...base, currency: "JPY" }), null);
  // 主货币未配置积分汇率
  assert.equal(estimateCredits({ ...base, currencies: [{ code: "USD", rateToBase: "1", isBase: true, creditRate: null }] }), null);
  // credit 模式不需要汇率
  const credit = estimateCredits({ ...base, billingMode: "credit", currency: null });
  assert.ok(credit !== null, "积分模式即使没有汇率配置也应能估价");
});

test("estimateCredits 在零用量时返回 0，不等于无法计价", () => {
  const credits = estimateCredits({
    tiers: TIERS,
    billingMode: "token",
    currency: "USD",
    priorityMultipliers: {},
    priorityTier: null,
    period: ALL_PERIOD,
    inputTokens: 0,
    outputTokens: 0,
    currencies: CURRENCIES,
  });
  assert.equal(credits, 0n);
});

test("快照的四个维度都有中文标签，日志明细靠它渲染", () => {
  // 将来新增计费维度却忘了加标签时，明细表会露出英文 key，这条用例提前拦住
  for (const kind of ["input", "output", "cacheWrite", "cacheRead"] as const) {
    assert.ok(BREAKDOWN_LABELS[kind], `缺少 ${kind} 的中文标签`);
  }
});

test("computeCost 的 breakdown 覆盖全部四个维度且顺序稳定", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 1000,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 40,
    priorityMultipliers: {},
    period: ALL_PERIOD,
  })!;
  assert.deepEqual(
    r.breakdown.map((b) => b.kind),
    ["input", "output", "cacheWrite", "cacheRead"],
  );
  // 明细行的 token 数必须与用量一致，否则对不上账
  assert.deepEqual(
    r.breakdown.map((b) => b.tokens),
    [10, 20, 40, 30],
  );
  // 单价保留原始 numeric 字符串，明细直接展示
  assert.equal(r.breakdown[0].unitPrice, "2");
  assert.equal(r.breakdown[3].unitPrice, "0.1");
});

test("明细各维度之和 × 倍率 等于费用总额（弹窗合计行的依据）", () => {
  const r = computeCost({
    tiers: TIERS,
    contextTokens: 100_000,
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    cacheReadTokens: 200_000,
    cacheWriteTokens: 100_000,
    priorityMultipliers: { priority: 3 },
    priorityTier: "priority",
    period: ALL_PERIOD,
  })!;
  const sum = r.breakdown.reduce((acc, b) => acc + b.amount, 0n);
  assert.equal(applyMultiplier(sum, parseMultiplier(3)), r.amountScaled);
});
