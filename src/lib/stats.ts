import "server-only";
import { count, desc, eq, gte, sql, sum } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { db } from "./db";
import { apiKeys, models, providers, requestLogs, users } from "./db/schema";

export async function getRecentLogs(limit = 100) {
  await requireAdmin();
  return db
    .select({
      id: requestLogs.id,
      createdAt: requestLogs.createdAt,
      apiType: requestLogs.apiType,
      model: requestLogs.model,
      stream: requestLogs.stream,
      status: requestLogs.status,
      attempts: requestLogs.attempts,
      latencyMs: requestLogs.latencyMs,
      inputTokens: requestLogs.inputTokens,
      outputTokens: requestLogs.outputTokens,
      error: requestLogs.error,
      providerName: providers.name,
      userName: users.name,
      keyName: apiKeys.name,
    })
    .from(requestLogs)
    .leftJoin(providers, eq(providers.id, requestLogs.providerId))
    .leftJoin(users, eq(users.id, requestLogs.userId))
    .leftJoin(apiKeys, eq(apiKeys.id, requestLogs.apiKeyId))
    .orderBy(desc(requestLogs.createdAt))
    .limit(limit);
}

export async function getDashboardStats() {
  await requireAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [[counts], [traffic], byProvider] = await Promise.all([
    db
      .select({
        providers: sql<number>`(select count(*)::int from ${providers})`,
        models: sql<number>`(select count(*)::int from ${models})`,
        users: sql<number>`(select count(*)::int from ${users})`,
        keys: sql<number>`(select count(*)::int from ${apiKeys})`,
      })
      .from(sql`(select 1) as one`),
    db
      .select({
        total: count(),
        success: sql<number>`(count(*) filter (where ${requestLogs.status} between 200 and 399))::int`,
        avgLatency: sql<number>`coalesce(avg(${requestLogs.latencyMs}), 0)::int`,
        inputTokens: sum(requestLogs.inputTokens).mapWith(Number),
        outputTokens: sum(requestLogs.outputTokens).mapWith(Number),
      })
      .from(requestLogs)
      .where(gte(requestLogs.createdAt, since)),
    db
      .select({ name: providers.name, n: count() })
      .from(requestLogs)
      .innerJoin(providers, eq(providers.id, requestLogs.providerId))
      .where(gte(requestLogs.createdAt, since))
      .groupBy(providers.name)
      .orderBy(desc(count()))
      .limit(6),
  ]);
  return { counts, traffic, byProvider };
}
