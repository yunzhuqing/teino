import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import {
  apiKeys,
  billingPeriods,
  currencies,
  entityTags,
  models,
  modelPrices,
  providers,
  tags,
  users,
  type BillingMode,
  type CurrencyCode,
} from "../db/schema";
import type { PriceTier } from "../billing/pricing";
import type { RouteCandidate } from "./routing";

export interface CallerContext {
  apiKeyId: string;
  userId: string;
  tagIds: string[];
  /** 积分余额（字符串，numeric 精度），由调用方用 money.ts 解析 */
  creditBalance: string;
}

export interface CandidateWithSecret extends RouteCandidate {
  defaultMaxTokens: number | null;
  billingMode: BillingMode;
  currency: CurrencyCode | null;
  priorityMultipliers: Record<string, number>;
  /** 供应商折扣率（numeric 字符串，1 = 无折扣） */
  discount: string;
  /** 该模型启用的价格档，按 period 分组由计价模块挑选 */
  prices: PriceTier[];
  provider: RouteCandidate["provider"] & {
    baseUrl: string;
    apiKeyEncrypted: string;
    extraHeaders: Record<string, string>;
  };
}

export type CallerResult = { ok: true; caller: CallerContext } | { ok: false; reason: string };

/**
 * 一次并行加载：调用方（Key + 用户 + 标签）、候选模型及其标签、请求头标签。
 * 查询互不依赖（使用子查询），避免串行瀑布。
 */
export async function loadRoutingContext(keyHash: string, modelName: string, requiredTagNames: string[]) {
  const keyIdSub = db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
  const userIdSub = db.select({ id: apiKeys.userId }).from(apiKeys).where(eq(apiKeys.keyHash, keyHash));

  const [keyRows, callerTagRows, candidateRows, candidateTagRows, requiredTagRows, priceRows, periodRows, currencyRows] =
    await Promise.all([
      db
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          enabled: apiKeys.enabled,
          expiresAt: apiKeys.expiresAt,
          userEnabled: users.enabled,
          creditBalance: apiKeys.creditBalance,
        })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1),
      db
        .selectDistinct({ tagId: entityTags.tagId })
        .from(entityTags)
        .where(
          or(
            and(eq(entityTags.entityType, "api_key"), inArray(entityTags.entityId, keyIdSub)),
            and(eq(entityTags.entityType, "user"), inArray(entityTags.entityId, userIdSub)),
          ),
        ),
      loadCandidates(modelName),
      loadCandidateTags(modelName),
      requiredTagNames.length
        ? db.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, requiredTagNames))
        : Promise.resolve([]),
      loadPrices(modelName),
      // 时段与汇率很小且几乎不变，随路由上下文一起取，避免结算时再查一次（结算在 after() 中，读不到请求级缓存）
      db
        .select({ name: billingPeriods.name, startMinute: billingPeriods.startMinute, endMinute: billingPeriods.endMinute, timezone: billingPeriods.timezone })
        .from(billingPeriods)
        .where(eq(billingPeriods.enabled, true)),
      db.select().from(currencies),
    ]);

  const key = keyRows[0];
  let callerResult: CallerResult;
  if (!key) callerResult = { ok: false, reason: "无效的 API Key" };
  else if (!key.enabled) callerResult = { ok: false, reason: "API Key 已禁用" };
  else if (!key.userEnabled) callerResult = { ok: false, reason: "用户已禁用" };
  else if (key.expiresAt && key.expiresAt.getTime() < Date.now()) callerResult = { ok: false, reason: "API Key 已过期" };
  else
    callerResult = {
      ok: true,
      caller: {
        apiKeyId: key.id,
        userId: key.userId,
        tagIds: callerTagRows.map((r) => r.tagId),
        creditBalance: key.creditBalance,
      },
    };

  const modelTags = new Map<string, string[]>();
  const providerTags = new Map<string, string[]>();
  for (const r of candidateTagRows) {
    const map = r.entityType === "model" ? modelTags : providerTags;
    const list = map.get(r.entityId);
    if (list) list.push(r.tagId);
    else map.set(r.entityId, [r.tagId]);
  }

  const pricesByModel = new Map<string, PriceTier[]>();
  for (const p of priceRows) {
    const list = pricesByModel.get(p.modelId);
    if (list) list.push(p);
    else pricesByModel.set(p.modelId, [p]);
  }

  const candidates: CandidateWithSecret[] = candidateRows.map((r) => ({
    modelId: r.modelId,
    modelName: r.modelName,
    upstreamModel: r.upstreamModel || r.modelName,
    modelApiType: r.modelApiType,
    defaultMaxTokens: r.defaultMaxTokens,
    priority: r.priority,
    weight: r.weight,
    modelEnabled: r.modelEnabled,
    modelTagIds: modelTags.get(r.modelId) ?? [],
    billingMode: r.billingMode,
    currency: r.currency,
    priorityMultipliers: r.priorityMultipliers,
    discount: r.discount,
    prices: pricesByModel.get(r.modelId) ?? [],
    provider: {
      id: r.providerId,
      name: r.providerName,
      enabled: r.providerEnabled,
      apiTypes: r.apiTypes,
      tagIds: providerTags.get(r.providerId) ?? [],
      baseUrl: r.baseUrl,
      apiKeyEncrypted: r.apiKeyEncrypted,
      extraHeaders: r.extraHeaders,
    },
  }));

  // 请求头中包含未知标签名时加入不可能匹配的占位，确保不会误路由
  const known = new Set(requiredTagRows.map((t) => t.name));
  const requiredTagIds = requiredTagRows.map((t) => t.id);
  if (requiredTagNames.some((n) => !known.has(n))) requiredTagIds.push("__unknown__");

  return { callerResult, candidates, requiredTagIds, periods: periodRows, currencies: currencyRows };
}

function loadCandidates(modelName: string) {
  return db
    .select({
      modelId: models.id,
      modelName: models.name,
      upstreamModel: models.upstreamModel,
      modelApiType: models.apiType,
      defaultMaxTokens: models.defaultMaxTokens,
      priority: models.priority,
      weight: models.weight,
      modelEnabled: models.enabled,
      billingMode: models.billingMode,
      currency: models.currency,
      priorityMultipliers: models.priorityMultipliers,
      discount: models.discount,
      providerId: providers.id,
      providerName: providers.name,
      providerEnabled: providers.enabled,
      apiTypes: providers.apiTypes,
      baseUrl: providers.baseUrl,
      apiKeyEncrypted: providers.apiKeyEncrypted,
      extraHeaders: providers.extraHeaders,
    })
    .from(models)
    .innerJoin(providers, eq(providers.id, models.providerId))
    .where(eq(models.name, modelName));
}

/** 候选模型启用的价格档（仅该模型名下，避免全表扫描） */
function loadPrices(modelName: string) {
  const modelIds = db.select({ id: models.id }).from(models).where(eq(models.name, modelName));
  return db
    .select({
      id: modelPrices.id,
      modelId: modelPrices.modelId,
      contextMin: modelPrices.contextMin,
      contextMax: modelPrices.contextMax,
      period: modelPrices.period,
      inputPrice: modelPrices.inputPrice,
      outputPrice: modelPrices.outputPrice,
      cacheWritePrice: modelPrices.cacheWritePrice,
      cacheReadPrice: modelPrices.cacheReadPrice,
    })
    .from(modelPrices)
    .where(and(eq(modelPrices.enabled, true), inArray(modelPrices.modelId, modelIds)));
}

function loadCandidateTags(modelName: string) {
  const modelIds = db.select({ id: models.id }).from(models).where(eq(models.name, modelName));
  const providerIds = db.select({ id: models.providerId }).from(models).where(eq(models.name, modelName));
  return db
    .select({ tagId: entityTags.tagId, entityType: entityTags.entityType, entityId: entityTags.entityId })
    .from(entityTags)
    .where(
      or(
        and(eq(entityTags.entityType, "model"), inArray(entityTags.entityId, modelIds)),
        and(eq(entityTags.entityType, "provider"), inArray(entityTags.entityId, providerIds)),
      ),
    );
}
