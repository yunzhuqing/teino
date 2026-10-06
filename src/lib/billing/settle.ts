import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, creditLedger, requestLogs, type BillingMode, type CurrencyCode } from "../db/schema";
import { estimateCredits as estimateCreditsPure, selectPeriod, settle, computeCost, type CurrencyRow, type PeriodWindow, type PriceTier } from "./pricing";
import { formatAmount, formatCredit } from "./money";

/**
 * 计费总开关。默认关闭，便于灰度：关掉之后只写 token 用量，不计价也不扣减。
 * 与 handler.ts 的环境变量范式一致。
 */
export const BILLING_ENABLED = process.env.BILLING_ENABLED === "true" || process.env.BILLING_ENABLED === "1";

export interface BillingTarget {
  modelId: string;
  modelName: string;
  billingMode: BillingMode;
  currency: CurrencyCode | null;
  priorityMultipliers: Record<string, number>;
  prices: PriceTier[];
}

export interface ChargeInput {
  apiKeyId: string;
  userId: string | null;
  requestLogId: string | null;
  target: BillingTarget;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  priorityTier: string | null;
  periods: PeriodWindow[];
  currencies: CurrencyRow[];
}

/**
 * 结算一次请求：算出原币费用 → 折算积分 → 原子扣减余额 → 写流水。
 *
 * 全程不抛异常：调用发生在响应已经返回客户端之后，任何失败都只能记日志，
 * 绝不能影响已完成的请求（与 writeLog 同样的策略）。
 */
export async function settleRequest(input: ChargeInput): Promise<void> {
  if (!BILLING_ENABLED) return;
  try {
    const period = selectPeriod(input.periods, new Date());

    const cost = computeCost(
      {
        tiers: input.target.prices,
        // 档位判定只看输入侧总量（新增输入 + 缓存命中 + 缓存写入），与 OpenAI 官方分档口径一致。
        // 若把输出也算进来，一个缓存命中很多的长对话会被推到更高价位，与上游账单对不上。
        contextTokens: input.inputTokens + input.cacheReadTokens + input.cacheWriteTokens,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: input.cacheReadTokens,
        cacheWriteTokens: input.cacheWriteTokens,
        priorityTier: input.priorityTier,
        priorityMultipliers: input.target.priorityMultipliers,
        period,
      },
      // 正式结算时超出档位按最贵档兜底，宁可多收也不白送
      true,
    );
    if (!cost) {
      console.warn(`[billing] 模型 ${input.target.modelName} 在时段 ${period} 下没有可用的价格档，本次未计费`);
      return;
    }
    if (cost.overflowed) {
      console.warn(
        `[billing] 模型 ${input.target.modelName} 的上下文用量（${input.inputTokens + input.cacheReadTokens + input.cacheWriteTokens}）超出所有价格档，已按最贵档兜底计费，请补充档位配置`,
      );
    }

    const s = settle({
      mode: input.target.billingMode,
      amountScaled: cost.amountScaled,
      currency: input.target.currency,
      currencies: input.currencies,
    });
    if (!s) {
      console.warn(`[billing] 模型 ${input.target.modelName} 缺少可用汇率或 creditRate，本次未计费`);
      return;
    }

    // 原子扣减：用单条 UPDATE 而非「读-改-写」，Neon HTTP driver 无交互式事务。
    // 余额允许扣成负数：请求已经服务完毕，欠账必须留在账上，门槛由 handler 的预检承担。
    const [updated] = await db
      .update(apiKeys)
      .set({ creditBalance: sql`${apiKeys.creditBalance} - ${formatCredit(s.credits)}::numeric` })
      .where(eq(apiKeys.id, input.apiKeyId))
      .returning({ creditBalance: apiKeys.creditBalance });

    const balanceAfter = updated?.creditBalance ?? "0";

    const priceSnapshot = {
      tierId: cost.tierId,
      period: cost.period,
      priorityTier: cost.priorityTier,
      multiplier: cost.multiplier,
      overflowed: cost.overflowed,
      breakdown: cost.breakdown.map((b) => ({ kind: b.kind, tokens: b.tokens, unitPrice: b.unitPrice, amount: formatAmount(b.amount) })),
    };

    // 日志写入失败时 requestLogId 为 null，此时只记流水、不回写日志
    const ledger = db.insert(creditLedger).values({
      apiKeyId: input.apiKeyId,
      userId: input.userId,
      requestLogId: input.requestLogId,
      entryType: "consume",
      amount: formatCredit(-s.credits),
      balanceAfter,
      amountOriginal: formatAmount(s.amountScaled),
      currency: (s.currency as CurrencyCode | null) ?? null,
      priceSnapshot,
    });

    if (input.requestLogId) {
      await db.batch([
        ledger,
        db
          .update(requestLogs)
          .set({
            costOriginal: formatAmount(s.amountScaled),
            currency: (s.currency as CurrencyCode | null) ?? null,
            creditsCharged: formatCredit(s.credits),
            priceTierId: cost.tierId,
            period: cost.period,
            priorityTier: cost.priorityTier,
            multiplier: String(cost.multiplier),
          })
          .where(eq(requestLogs.id, input.requestLogId)),
      ]);
    } else {
      await ledger;
    }
  } catch (err) {
    console.error("[billing] 结算失败", err);
  }
}

/** 估算一次请求的积分成本，用于转发前的余额预检；无法计价时返回 null（视为不拦截） */
export function estimateCredits(params: {
  target: BillingTarget;
  inputTokens: number;
  outputTokens: number;
  priorityTier: string | null;
  period: string;
  currencies: CurrencyRow[];
}): bigint | null {
  return estimateCreditsPure({
    tiers: params.target.prices,
    billingMode: params.target.billingMode,
    currency: params.target.currency,
    priorityMultipliers: params.target.priorityMultipliers,
    priorityTier: params.priorityTier,
    period: params.period,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    currencies: params.currencies,
  });
}
