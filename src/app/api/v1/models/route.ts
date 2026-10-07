import { sha256 } from "@/lib/crypto";
import { authenticateKey, loadCatalog, loadKeyTagIds, visibleEntries } from "@/lib/gateway/catalog";

/** OpenAI 兼容的模型列表：只列出该 Key 按标签规则能路由到的模型 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");
  if (!key) return Response.json({ error: { message: "缺少 API Key", type: "invalid_api_key" } }, { status: 401 });

  const [caller, catalog] = await Promise.all([authenticateKey(sha256(key)), loadCatalog()]);
  if (!caller) {
    return Response.json({ error: { message: "无效的 API Key", type: "invalid_api_key" } }, { status: 401 });
  }

  const tagIds = await loadKeyTagIds(caller.id, caller.userId);
  const names = [...new Set(visibleEntries(catalog, [tagIds]).map((c) => c.modelName))];
  return Response.json({
    object: "list",
    data: names.map((id) => ({ id, object: "model", created: 0, owned_by: "teino-gateway" })),
  });
}
