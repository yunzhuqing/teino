import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, entityTags, models, modelPrices, providers, users, type BillingMode, type CurrencyCode } from "../db/schema";
import { ALL_PERIOD, type PriceTier } from "../billing/pricing";
import { isVisibleTo, type RouteCandidate } from "./routing";

export interface CatalogEntry extends RouteCandidate {
  billingMode: BillingMode;
  currency: CurrencyCode | null;
  discount: string;
  prices: PriceTier[];
}

/**
 * 全量模型目录（含标签与启用的价格档），供模型列表展示。
 * 与路由共用 isVisibleTo 判定可见性，保证「看得到」与「调得通」一致。
 */
export async function loadCatalog(): Promise<CatalogEntry[]> {
  const [rows, tagRows, priceRows] = await Promise.all([
    db
      .select({
        modelId: models.id,
        modelName: models.name,
        upstreamModel: models.upstreamModel,
        modelApiType: models.apiType,
        priority: models.priority,
        weight: models.weight,
        modelEnabled: models.enabled,
        billingMode: models.billingMode,
        currency: models.currency,
        discount: models.discount,
        providerId: providers.id,
        providerName: providers.name,
        providerEnabled: providers.enabled,
        apiTypes: providers.apiTypes,
      })
      .from(models)
      .innerJoin(providers, eq(providers.id, models.providerId))
      .where(and(eq(models.enabled, true), eq(providers.enabled, true)))
      .orderBy(models.name),
    db
      .select({ tagId: entityTags.tagId, entityType: entityTags.entityType, entityId: entityTags.entityId })
      .from(entityTags)
      .where(inArray(entityTags.entityType, ["model", "provider"])),
    db
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
      .where(eq(modelPrices.enabled, true)),
  ]);

  const tagsOf = new Map<string, string[]>();
  for (const r of tagRows) {
    const key = `${r.entityType}:${r.entityId}`;
    const list = tagsOf.get(key);
    if (list) list.push(r.tagId);
    else tagsOf.set(key, [r.tagId]);
  }
  const pricesOf = new Map<string, PriceTier[]>();
  for (const p of priceRows) {
    const list = pricesOf.get(p.modelId);
    if (list) list.push(p);
    else pricesOf.set(p.modelId, [p]);
  }

  return rows.map((r) => ({
    modelId: r.modelId,
    modelName: r.modelName,
    upstreamModel: r.upstreamModel || r.modelName,
    modelApiType: r.modelApiType,
    priority: r.priority,
    weight: r.weight,
    modelEnabled: r.modelEnabled,
    modelTagIds: tagsOf.get(`model:${r.modelId}`) ?? [],
    billingMode: r.billingMode,
    currency: r.currency,
    discount: r.discount,
    prices: pricesOf.get(r.modelId) ?? [],
    provider: {
      id: r.providerId,
      name: r.providerName,
      enabled: r.providerEnabled,
      apiTypes: r.apiTypes,
      tagIds: tagsOf.get(`provider:${r.providerId}`) ?? [],
    },
  }));
}

/** 任一调用方标签组能用到即可见；tagSets 为空数组表示没有调用方 */
export function visibleEntries<T extends RouteCandidate>(catalog: readonly T[], tagSets: readonly (readonly string[])[]): T[] {
  return catalog.filter((c) => tagSets.some((tags) => isVisibleTo(c, tags)));
}

/** 价格展示用的基准档：兜底时段、起始上下文区间（多数模型只有这一档） */
export function basePriceTier(prices: readonly PriceTier[]): PriceTier | null {
  const sorted = [...prices].sort((a, b) => Number(a.period !== ALL_PERIOD) - Number(b.period !== ALL_PERIOD) || a.contextMin - b.contextMin);
  return sorted[0] ?? null;
}

/** Key 的调用方标签 = Key 标签 ∪ 所属用户标签（与路由一致） */
export async function loadKeyTagIds(apiKeyId: string, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tagId: entityTags.tagId })
    .from(entityTags)
    .where(
      or(
        and(eq(entityTags.entityType, "api_key"), eq(entityTags.entityId, apiKeyId)),
        and(eq(entityTags.entityType, "user"), eq(entityTags.entityId, userId)),
      ),
    );
  return rows.map((r) => r.tagId);
}

/** /v1/models 的 Key 校验，规则与网关转发一致 */
export async function authenticateKey(keyHash: string) {
  const [key] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, enabled: apiKeys.enabled, expiresAt: apiKeys.expiresAt, userEnabled: users.enabled })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  if (!key?.enabled || !key.userEnabled || (key.expiresAt && key.expiresAt.getTime() < Date.now())) return null;
  return key;
}
