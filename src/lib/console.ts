import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lt, or, sql, sum, type SQL } from "drizzle-orm";
import { requireUserPage } from "./auth";
import { db } from "./db";
import { API_TYPES, apiKeys, creditLedger, currencies, entityTags, providers, requestLogs, type CurrencyCode } from "./db/schema";
import { formatAmount, parseAmount, toBase, type CurrencyRow } from "./billing/pricing";
import { basePriceTier, loadCatalog, visibleEntries } from "./gateway/catalog";
import type { DateRange } from "./date-range";
import { sanitizeError } from "./gateway/sanitize";

/**
 * 用户控制台的数据读取。所有查询都以 requireUser() 返回的用户 id 限定范围，
 * 不接受调用方传入 userId —— 防止越权读到他人的 Key 与日志。
 */

export async function getMyKeys() {
  const user = await requireUserPage();
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      enabled: apiKeys.enabled,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      creditBalance: apiKeys.creditBalance,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt));
}

async function loadCurrencyRows(): Promise<CurrencyRow[]> {
  const rows = await db.select().from(currencies);
  return rows.map((c) => ({ code: c.code, rateToBase: c.rateToBase, isBase: c.isBase, creditRate: c.creditRate }));
}

export interface UsageBucket {
  requests: number;
  success: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 折算成主货币后的费用（numeric 字符串） */
  cost: string;
  credits: number;
}

function zeroUsage(): UsageBucket {
  return { requests: 0, success: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: "0", credits: 0 };
}

/** 用量聚合的列：同一维度可能跨多个币种，按 (维度, 币种) 分组取回，在应用层折算后再合并 */
const usageColumns = {
  currency: requestLogs.currency,
  requests: count(),
  success: sql<number>`(count(*) filter (where ${requestLogs.status} between 200 and 399))::int`,
  inputTokens: sum(requestLogs.inputTokens).mapWith(Number),
  outputTokens: sum(requestLogs.outputTokens).mapWith(Number),
  cacheReadTokens: sum(requestLogs.cacheReadTokens).mapWith(Number),
  cacheWriteTokens: sum(requestLogs.cacheWriteTokens).mapWith(Number),
  cost: sum(requestLogs.costOriginal).mapWith(String),
  credits: sum(requestLogs.creditsCharged).mapWith(Number),
};

interface UsageRow<K> {
  key: K;
  currency: CurrencyCode | null;
  requests: number;
  success: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: string | null;
  credits: number | null;
}

function mergeUsage<K>(rows: UsageRow<K>[], currencyRows: CurrencyRow[]): Map<K, UsageBucket> {
  const map = new Map<K, UsageBucket & { costScaled: bigint }>();
  for (const r of rows) {
    let b = map.get(r.key);
    if (!b) map.set(r.key, (b = { ...zeroUsage(), costScaled: 0n }));
    b.requests += r.requests;
    b.success += r.success;
    b.inputTokens += r.inputTokens ?? 0;
    b.outputTokens += r.outputTokens ?? 0;
    b.cacheReadTokens += r.cacheReadTokens ?? 0;
    b.cacheWriteTokens += r.cacheWriteTokens ?? 0;
    b.credits += r.credits ?? 0;
    b.costScaled += toBase(parseAmount(r.cost ?? "0"), r.currency, currencyRows);
  }
  return new Map([...map].map(([k, { costScaled, ...b }]) => [k, { ...b, cost: formatAmount(costScaled) }]));
}

/** 用量与费用：总计、按 Key、按模型 */
export async function getMyUsage(range: DateRange) {
  const user = await requireUserPage();
  const where = and(eq(requestLogs.userId, user.id), gte(requestLogs.createdAt, range.start), lt(requestLogs.createdAt, range.end));

  const [byKeyRows, byModelRows, keys, currencyRows] = await Promise.all([
    db
      .select({ ...usageColumns, key: requestLogs.apiKeyId })
      .from(requestLogs)
      .where(where)
      .groupBy(requestLogs.apiKeyId, requestLogs.currency),
    db
      .select({ ...usageColumns, key: requestLogs.model })
      .from(requestLogs)
      .where(where)
      .groupBy(requestLogs.model, requestLogs.currency),
    db
      .select({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, creditBalance: apiKeys.creditBalance })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id))
      .orderBy(asc(apiKeys.createdAt)),
    loadCurrencyRows(),
  ]);

  const byKey = mergeUsage(byKeyRows, currencyRows);
  const byModel = mergeUsage(byModelRows, currencyRows);
  const total = mergeUsage(
    byKeyRows.map((r) => ({ ...r, key: "all" })),
    currencyRows,
  ).get("all") ?? zeroUsage();

  const keyById = new Map(keys.map((k) => [k.id, k]));
  const sortByCost = <T extends { usage: UsageBucket }>(a: T, b: T) => Number(b.usage.cost) - Number(a.usage.cost) || b.usage.requests - a.usage.requests;

  return {
    baseCurrency: currencyRows.find((c) => c.isBase)?.code ?? null,
    total,
    balance: keys.reduce((s, k) => s + Number(k.creditBalance), 0),
    keys: [
      // 有余额但区间内无调用的 Key 也列出来，方便对照余额
      ...keys.map((k) => ({ id: k.id as string | null, name: k.name, keyPrefix: k.keyPrefix, creditBalance: k.creditBalance as string | null, usage: byKey.get(k.id) ?? zeroUsage() })),
      // Key 被删除后日志的 api_key_id 置空，但用量仍归属该用户
      ...[...byKey].filter(([id]) => !id || !keyById.has(id)).map(([, usage]) => ({ id: null, name: "已删除的 Key", keyPrefix: null, creditBalance: null, usage })),
    ].sort(sortByCost),
    models: [...byModel].map(([model, usage]) => ({ model, usage })).sort(sortByCost),
  };
}

export const LOGS_PAGE_SIZE = 50;

export interface LogFilters {
  apiKeyId?: string;
  model?: string;
  range: DateRange;
  page: number;
}

/** 请求明细（分页）。多取一行判断是否还有下一页，避免额外的 count(*) */
export async function getMyLogs({ apiKeyId, model, range, page }: LogFilters) {
  const user = await requireUserPage();
  const conditions: SQL[] = [eq(requestLogs.userId, user.id), gte(requestLogs.createdAt, range.start), lt(requestLogs.createdAt, range.end)];
  if (apiKeyId) conditions.push(eq(requestLogs.apiKeyId, apiKeyId));
  if (model) conditions.push(eq(requestLogs.model, model));

  const rows = await db
    .select({
      id: requestLogs.id,
      createdAt: requestLogs.createdAt,
      apiType: requestLogs.apiType,
      model: requestLogs.model,
      stream: requestLogs.stream,
      status: requestLogs.status,
      latencyMs: requestLogs.latencyMs,
      inputTokens: requestLogs.inputTokens,
      outputTokens: requestLogs.outputTokens,
      cacheReadTokens: requestLogs.cacheReadTokens,
      cacheWriteTokens: requestLogs.cacheWriteTokens,
      costOriginal: requestLogs.costOriginal,
      currency: requestLogs.currency,
      creditsCharged: requestLogs.creditsCharged,
      period: requestLogs.period,
      priorityTier: requestLogs.priorityTier,
      multiplier: requestLogs.multiplier,
      error: requestLogs.error,
      keyName: apiKeys.name,
      priceSnapshot: creditLedger.priceSnapshot,
      balanceAfter: creditLedger.balanceAfter,
    })
    .from(requestLogs)
    .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
    .leftJoin(creditLedger, eq(creditLedger.requestLogId, requestLogs.id))
    .where(and(...conditions))
    .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
    .limit(LOGS_PAGE_SIZE + 1)
    .offset((page - 1) * LOGS_PAGE_SIZE);

  const pageRows = rows.slice(0, LOGS_PAGE_SIZE);
  const providerNames = pageRows.some((r) => r.error) ? (await db.select({ name: providers.name }).from(providers)).map((p) => p.name) : [];
  return {
    rows: pageRows.map((r) => ({ ...r, error: r.error ? sanitizeError(r.error, providerNames) : null })),
    hasMore: rows.length > LOGS_PAGE_SIZE,
  };
}

/** 明细筛选下拉用：该用户在区间内调用过的模型名 */
export async function getMyLogModels(range: DateRange) {
  const user = await requireUserPage();
  const rows = await db
    .selectDistinct({ model: requestLogs.model })
    .from(requestLogs)
    .where(and(eq(requestLogs.userId, user.id), gte(requestLogs.createdAt, range.start), lt(requestLogs.createdAt, range.end)))
    .orderBy(asc(requestLogs.model));
  return rows.map((r) => r.model);
}

/** 该用户（经其任一 Key）能调用的模型，按模型名聚合各候选上游的价格 */
export async function getMyModels() {
  const user = await requireUserPage();
  const keyIds = db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, user.id));
  const [catalog, tagRows, keys, currencyRows] = await Promise.all([
    loadCatalog(),
    db
      .select({ entityType: entityTags.entityType, entityId: entityTags.entityId, tagId: entityTags.tagId })
      .from(entityTags)
      .where(
        or(
          and(eq(entityTags.entityType, "user"), eq(entityTags.entityId, user.id)),
          and(eq(entityTags.entityType, "api_key"), inArray(entityTags.entityId, keyIds)),
        ),
      ),
    db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, user.id)),
    loadCurrencyRows(),
  ]);

  // 调用方标签 = Key 标签 ∪ 用户标签；还没有 Key 时按用户标签预览
  const userTags = tagRows.filter((r) => r.entityType === "user").map((r) => r.tagId);
  const tagSets = keys.length
    ? keys.map((k) => [...userTags, ...tagRows.filter((r) => r.entityType === "api_key" && r.entityId === k.id).map((r) => r.tagId)])
    : [userTags];

  const byName = new Map<string, typeof catalog>();
  for (const c of visibleEntries(catalog, tagSets)) {
    const list = byName.get(c.modelName);
    if (list) list.push(c);
    else byName.set(c.modelName, [c]);
  }

  return {
    baseCurrency: currencyRows.find((c) => c.isBase)?.code ?? null,
    models: [...byName].map(([name, entries]) => {
      // 只展示最高优先级层的价格：正常情况下请求都落在这一层
      const top = Math.max(...entries.map((e) => e.priority));
      const primary = entries.filter((e) => e.priority === top);
      return {
        name,
        // 声明了上游协议的模型由网关做协议转换，任何请求协议都能调用
        apiTypes: entries.some((e) => e.modelApiType) ? [...API_TYPES] : [...new Set(entries.flatMap((e) => e.provider.apiTypes))],
        tiered: entries.some((e) => e.prices.length > 1),
        prices: primary.flatMap((e) => {
          const tier = basePriceTier(e.prices);
          if (!tier) return [];
          const discount = Number(e.discount);
          const apply = (v: string) => Number(v) * discount;
          return [
            {
              billingMode: e.billingMode,
              currency: e.currency,
              input: apply(tier.inputPrice),
              output: apply(tier.outputPrice),
              cacheRead: apply(tier.cacheReadPrice),
              cacheWrite: apply(tier.cacheWritePrice),
            },
          ];
        }),
      };
    }),
  };
}
