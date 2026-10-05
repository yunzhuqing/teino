import "server-only";
import { cache } from "react";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { db } from "./db";
import { apiKeys, entityTags, models, providers, tags, users, type TagEntityType } from "./db/schema";

/** 标签列表（同一请求内去重） */
export const getTags = cache(async () => {
  await requireAdmin();
  return db.select().from(tags).orderBy(asc(tags.name));
});

/** 指定实体类型的 entityId -> tagIds 映射 */
export const getTagMap = cache(async (entityType: TagEntityType) => {
  const rows = await db
    .select({ entityId: entityTags.entityId, tagId: entityTags.tagId })
    .from(entityTags)
    .where(eq(entityTags.entityType, entityType));
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.entityId] ??= []).push(r.tagId);
  return map;
});

export async function getProvidersWithModels() {
  await requireAdmin();
  const [providerRows, modelRows, providerTags, modelTags] = await Promise.all([
    db
      .select({
        id: providers.id,
        name: providers.name,
        baseUrl: providers.baseUrl,
        apiKeyHint: providers.apiKeyHint,
        apiTypes: providers.apiTypes,
        extraHeaders: providers.extraHeaders,
        enabled: providers.enabled,
      })
      .from(providers)
      .orderBy(asc(providers.createdAt)),
    db
      .select({
        id: models.id,
        providerId: models.providerId,
        name: models.name,
        upstreamModel: models.upstreamModel,
        apiType: models.apiType,
        defaultMaxTokens: models.defaultMaxTokens,
        priority: models.priority,
        weight: models.weight,
        enabled: models.enabled,
      })
      .from(models)
      .orderBy(desc(models.priority), desc(models.weight), asc(models.name)),
    getTagMap("provider"),
    getTagMap("model"),
  ]);
  const byProvider = new Map<string, ((typeof modelRows)[number] & { tagIds: string[] })[]>();
  for (const m of modelRows) {
    const item = { ...m, tagIds: modelTags[m.id] ?? [] };
    const list = byProvider.get(m.providerId);
    if (list) list.push(item);
    else byProvider.set(m.providerId, [item]);
  }
  return providerRows.map((p) => ({ ...p, tagIds: providerTags[p.id] ?? [], models: byProvider.get(p.id) ?? [] }));
}

export async function getUsers() {
  await requireAdmin();
  const [rows, tagMap] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        note: users.note,
        enabled: users.enabled,
        createdAt: users.createdAt,
        keyCount: sql<number>`(select count(*)::int from ${apiKeys} where ${apiKeys.userId} = ${users.id})`,
      })
      .from(users)
      .orderBy(asc(users.createdAt)),
    getTagMap("user"),
  ]);
  return rows.map((u) => ({ ...u, tagIds: tagMap[u.id] ?? [] }));
}

export async function getApiKeys() {
  await requireAdmin();
  const [rows, tagMap] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        enabled: apiKeys.enabled,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
        userId: apiKeys.userId,
        userName: users.name,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .orderBy(desc(apiKeys.createdAt)),
    getTagMap("api_key"),
  ]);
  return rows.map((k) => ({ ...k, tagIds: tagMap[k.id] ?? [] }));
}

export async function getUserOptions() {
  await requireAdmin();
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
}

export async function getTagUsage() {
  await requireAdmin();
  const rows = await db
    .select({ tagId: entityTags.tagId, entityType: entityTags.entityType, n: count() })
    .from(entityTags)
    .groupBy(entityTags.tagId, entityTags.entityType);
  const usage: Record<string, Partial<Record<TagEntityType, number>>> = {};
  for (const r of rows) (usage[r.tagId] ??= {})[r.entityType] = r.n;
  return usage;
}
