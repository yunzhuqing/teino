import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { loadAvailableModelNames } from "@/lib/gateway/logs";

/** OpenAI 兼容的模型列表（需要有效 API Key） */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!key) return Response.json({ error: { message: "缺少 API Key", type: "invalid_api_key" } }, { status: 401 });

  const [rows, names] = await Promise.all([
    db.select({ enabled: apiKeys.enabled }).from(apiKeys).where(eq(apiKeys.keyHash, sha256(key))).limit(1),
    loadAvailableModelNames(),
  ]);
  if (!rows[0]?.enabled) {
    return Response.json({ error: { message: "无效的 API Key", type: "invalid_api_key" } }, { status: 401 });
  }

  return Response.json({
    object: "list",
    data: names.map((id) => ({ id, object: "model", created: 0, owned_by: "teino-gateway" })),
  });
}
