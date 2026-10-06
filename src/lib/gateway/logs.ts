import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, models, providers, requestLogs, type ApiType } from "../db/schema";

/** /v1/models：列出所有启用的模型名 */
export async function loadAvailableModelNames(apiType?: ApiType) {
  const rows = await db
    .selectDistinct({ name: models.name })
    .from(models)
    .innerJoin(providers, eq(providers.id, models.providerId))
    .where(
      and(
        eq(models.enabled, true),
        eq(providers.enabled, true),
        apiType ? sql`${apiType}::api_type = any(${providers.apiTypes})` : undefined,
      ),
    )
    .orderBy(models.name);
  return rows.map((r) => r.name);
}

export interface LogEntry {
  apiKeyId: string | null;
  userId: string | null;
  providerId: string | null;
  modelId: string | null;
  apiType: ApiType;
  /** 发生协议转换时的上游协议 */
  upstreamApiType?: ApiType | null;
  model: string;
  stream: boolean;
  status: number;
  attempts: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  error?: string;
}

/** 写入请求日志，失败不影响主流程；返回新日志 id（供积分流水关联），失败返回 null */
export async function writeLog(entry: LogEntry): Promise<string | null> {
  try {
    const [row] = await Promise.all([
      db
        .insert(requestLogs)
        .values({ ...entry, error: entry.error?.slice(0, 2000) })
        .returning({ id: requestLogs.id }),
      entry.apiKeyId
        ? db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, entry.apiKeyId))
        : Promise.resolve(),
    ]);
    return row[0]?.id ?? null;
  } catch (err) {
    console.error("[gateway] 写入日志失败", err);
    return null;
  }
}
