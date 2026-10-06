import {
  AMOUNT_DECIMALS,
  amountScaleToCredit,
  amountToCredits,
  applyMultiplier,
  charge,
  convertCurrency,
  formatAmount,
  formatCredit,
  multiplierToNumber,
  parseAmount,
  parseMultiplier,
} from "./money";

/** 兜底时段名：命中不到任何时段窗口时使用，与 schema 的 FALLBACK_PERIOD 一致 */
export const ALL_PERIOD = "all";

/** 价格档：与 repository 载入的 model_prices 行结构一致 */
export interface PriceTier {
  id: string;
  modelId: string;
  contextMin: number;
  contextMax: number | null;
  period: string;
  /** 以下单价都是字符串（numeric），单位「每 100 万 token」，币种或积分由模型决定 */
  inputPrice: string;
  outputPrice: string;
  cacheWritePrice: string;
  cacheReadPrice: string;
}

/** 计费时段窗口，分钟数按 0-1439 表示当日时间 */
export interface PeriodWindow {
  name: string;
  startMinute: number;
  endMinute: number;
  timezone: string;
}

export interface UsageBreakdown {
  kind: "input" | "output" | "cacheWrite" | "cacheRead";
  tokens: number;
  unitPrice: string;
  /** 该维度的费用（定标整数，与输入金额同标度） */
  amount: bigint;
}

/** 明细行的中文标签，日志弹窗与流水共用 */
export const BREAKDOWN_LABELS: Record<UsageBreakdown["kind"], string> = {
  input: "输入",
  output: "输出",
  cacheWrite: "缓存创建",
  cacheRead: "缓存命中",
};

/**
 * 结算时写进 credit_ledger.price_snapshot 的快照。
 *
 * 价格档日后被改动或删除，靠这份快照仍能还原当时是按哪个档、哪个时段、什么单价算出来的，
 * 所以它是计费明细的唯一凭据（request_logs 只存结果，不存单价）。
 */
export interface PriceSnapshot {
  tierId: string;
  period: string;
  priorityTier: string | null;
  multiplier: number;
  /** 用量超出所有档位、按最贵档兜底计费 */
  overflowed: boolean;
  /** 各维度金额是应用倍率之前的值，合计 × multiplier 才等于费用总额 */
  breakdown: Array<{ kind: UsageBreakdown["kind"]; tokens: number; unitPrice: string; amount: string }>;
  /** 记录当时所用的汇率，便于事后复核折算链路 */
  currency?: string | null;
  /** 1 单位原币 = 多少主货币 */
  rateToBase?: string | null;
  /** 1 单位主货币 = 多少积分 */
  creditRate?: string | null;
  /** 主货币代码，折算展示时用 */
  baseCurrency?: string | null;
  /** 折算后的主货币金额（credit 模式为空） */
  amountBase?: string | null;
}

export interface PriceInput {
  tiers: PriceTier[];
  /** 判定档位用的上下文总量 */
  contextTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 请求声明的优先级档位（如 standard / priority / batch）；为空则倍率为 1 */
  priorityTier?: string | null;
  priorityMultipliers: Record<string, number>;
  /** 命中的时段名，由 selectPeriod 给出 */
  period: string;
  /** 模型币种（token 模式） */
  currency?: string | null;
}

export interface PriceResult {
  tierId: string;
  period: string;
  priorityTier: string | null;
  multiplier: number;
  /** 原币费用，1e-8 标度的字符串（未折算，未换算积分） */
  amountOriginal: string;
  /** 同上，定标整数形式，便于调用方继续折算 */
  amountScaled: bigint;
  breakdown: UsageBreakdown[];
  /** 用量超出所有已配置档位，已按最贵档兜底计费，调用方应告警提示补配置 */
  overflowed: boolean;
}

/** 把「当日某时刻」换算成分钟数，时区以窗口自己声明的为准 */
function minuteOfDayIn(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // hour12:false 在部分实现下会把午夜给成 24
  return ((hour % 24) * 60 + minute) % 1440;
}

/**
 * 选出当前生效的时段名。命中第一个包含当前时刻的启用窗口；都不命中则回落到兜底档 `all`。
 * 窗口含起点、不含终点；start > end 表示跨午夜（如 22:00-06:00）。
 */
export function selectPeriod(windows: PeriodWindow[], at: Date): string {
  const byZone = new Map<string, number>();
  for (const w of windows) {
    let minute = byZone.get(w.timezone);
    if (minute === undefined) {
      minute = minuteOfDayIn(at, w.timezone);
      byZone.set(w.timezone, minute);
    }
    const inWindow =
      w.startMinute <= w.endMinute
        ? minute >= w.startMinute && minute < w.endMinute
        : minute >= w.startMinute || minute < w.endMinute;
    if (inWindow) return w.name;
  }
  return ALL_PERIOD;
}

/**
 * 选出价格档：先在该时段内找上下文区间命中的档，找不到再回落到兜底档 `all`。
 * 区间为闭开 [contextMin, contextMax)，contextMax 为空表示无上限。
 *
 * overflow 为真时，若仍无匹配则退回该时段内起点最大的档（即最贵的档）——
 * 运营没把档位配到模型的最大上下文时，宁可多收也不能白送。调用方应同时告警。
 * 为假时返回 null，由调用方决定兜底策略。
 */
export function selectTier(tiers: PriceTier[], contextTokens: number, period: string, overflow = false): PriceTier | null {
  const fits = (t: PriceTier) => contextTokens >= t.contextMin && (t.contextMax === null || contextTokens < t.contextMax);
  // 同一时段理论上不会有重叠区间（server action 已校验），仍按 contextMin 升序取第一个，结果稳定
  const ordered = [...tiers].sort((a, b) => a.contextMin - b.contextMin);
  const hit = ordered.find((t) => t.period === period && fits(t)) ?? ordered.find((t) => t.period === ALL_PERIOD && fits(t));
  if (hit || !overflow) return hit ?? null;
  const inPeriod = ordered.filter((t) => t.period === period);
  const pool = inPeriod.length ? inPeriod : ordered;
  return pool.length ? pool[pool.length - 1] : null;
}

/** 请求优先级档位 -> 倍率；未声明的档位按 1 计 */
export function resolveMultiplier(multipliers: Record<string, number>, priorityTier?: string | null): bigint {
  if (!priorityTier) return 10_000n;
  const v = multipliers[priorityTier];
  return v === undefined ? 10_000n : parseMultiplier(v);
}

/**
 * 按用量算出原币费用。四个计费维度各自按单价计费后求和，倍率在合计后一次应用。
 * 调用方负责把结果折算成主货币或积分（见 currency.ts）。
 *
 * overflow 为真时（正式结算）：用量超出所有档位就按最贵的档兜底，不返回 null，
 * 否则运营少配一档就会白送请求。预检时传假，宁可放行也不误拦。
 */
export function computeCost(input: PriceInput, overflow = false): PriceResult | null {
  const matched = selectTier(input.tiers, input.contextTokens, input.period, overflow);
  if (!matched) return null;
  const tier = matched;
  // 兜底生效说明用量超出了所有已配置区间
  const overflowed = overflow && !(input.contextTokens >= tier.contextMin && (tier.contextMax === null || input.contextTokens < tier.contextMax));

  const multiplierScaled = resolveMultiplier(input.priorityMultipliers, input.priorityTier);

  const dimensions: Array<{ kind: UsageBreakdown["kind"]; tokens: number; price: string }> = [
    { kind: "input", tokens: input.inputTokens, price: tier.inputPrice },
    { kind: "output", tokens: input.outputTokens, price: tier.outputPrice },
    { kind: "cacheWrite", tokens: input.cacheWriteTokens, price: tier.cacheWritePrice },
    { kind: "cacheRead", tokens: input.cacheReadTokens, price: tier.cacheReadPrice },
  ];

  const breakdown: UsageBreakdown[] = [];
  let total = 0n;
  for (const d of dimensions) {
    const amount = charge(d.tokens, parseAmount(d.price));
    total += amount;
    breakdown.push({ kind: d.kind, tokens: d.tokens, unitPrice: d.price, amount });
  }

  const amountScaled = applyMultiplier(total, multiplierScaled);
  return {
    tierId: tier.id,
    period: input.period,
    priorityTier: input.priorityTier ?? null,
    multiplier: multiplierToNumber(multiplierScaled),
    amountOriginal: formatAmount(amountScaled),
    amountScaled,
    breakdown,
    overflowed,
  };
}

/** 汇率表的一行 */
export interface CurrencyRow {
  code: string;
  rateToBase: string;
  isBase: boolean;
  creditRate: string | null;
}

export interface SettleResult {
  /** 原币费用（定标整数，1e-8） */
  amountScaled: bigint;
  currency: string | null;
  /** 折算到主货币的金额（1e-8） */
  amountBase: bigint;
  /** 应扣积分（1e-6）。token 模式由金额折算而来；credit 模式即原币数字本身 */
  credits: bigint;
}

/**
 * 把计价结果折算成应扣积分。
 *
 * · credit 模式：价格数字本身就是积分，直接当作积分数
 * · token 模式：先按汇率折成主货币，再用主货币行的 creditRate 换成积分
 *
 * 缺汇率或主货币未配置 creditRate 时返回 null，调用方应拒绝结算而不是按 0 扣费。
 */
export function settle(params: {
  mode: "token" | "credit";
  amountScaled: bigint;
  currency?: string | null;
  currencies: CurrencyRow[];
}): SettleResult | null {
  const { mode, amountScaled, currency, currencies } = params;

  if (mode === "credit") {
    // 价格档里的数字就是积分，只是标度从 1e-8 降到积分的 1e-6
    const credits = amountScaleToCredit(amountScaled);
    return { amountScaled, currency: null, amountBase: 0n, credits };
  }

  if (!currency) return null;
  const row = currencies.find((c) => c.code === currency);
  if (!row) return null;
  const rate = parseAmount(row.rateToBase);
  const amountBase = row.isBase ? amountScaled : convertCurrency(amountScaled, rate);

  const baseRow = currencies.find((c) => c.isBase);
  if (!baseRow?.creditRate) return null;
  // creditRate 是汇率，与 numeric(20,8) 对齐，按金额标度解析
  const credits = amountToCredits(amountBase, parseAmount(baseRow.creditRate));

  return { amountScaled, currency, amountBase, credits };
}

/** 主货币行：折算展示的统一目标 */
export function baseCurrency(currencies: CurrencyRow[]): CurrencyRow | null {
  return currencies.find((c) => c.isBase) ?? null;
}

/**
 * 预估一次请求要扣多少积分，用于转发前的余额预检。
 *
 * 与正式结算走同一套 computeCost + settle，区别只在于用量是估算的；
 * 无法计价（没有匹配价格档、缺汇率或 creditRate）时返回 null，
 * 调用方应据此放行——拦截的依据不足时不该误伤请求。
 */
export function estimateCredits(params: {
  tiers: PriceTier[];
  billingMode: "token" | "credit";
  currency?: string | null;
  priorityMultipliers: Record<string, number>;
  priorityTier?: string | null;
  period: string;
  inputTokens: number;
  outputTokens: number;
  currencies: CurrencyRow[];
}): bigint | null {
  const cost = computeCost({
    tiers: params.tiers,
    // 预检时还不知道缓存命中情况，按全部当作新增输入估算（偏保守）
    contextTokens: params.inputTokens,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    priorityTier: params.priorityTier,
    priorityMultipliers: params.priorityMultipliers,
    period: params.period,
  });
  if (!cost) return null;
  const s = settle({
    mode: params.billingMode,
    amountScaled: cost.amountScaled,
    currency: params.currency,
    currencies: params.currencies,
  });
  return s?.credits ?? null;
}

/** 展示用：原币金额 → 主货币金额 */
export function toBase(amountScaled: bigint, currency: string | null | undefined, currencies: CurrencyRow[]): bigint {
  const base = baseCurrency(currencies);
  if (!base) return amountScaled;
  if (!currency || currency === base.code) return amountScaled;
  const row = currencies.find((c) => c.code === currency);
  return row ? convertCurrency(amountScaled, parseAmount(row.rateToBase)) : amountScaled;
}

export { AMOUNT_DECIMALS, formatAmount, formatCredit, parseAmount };
