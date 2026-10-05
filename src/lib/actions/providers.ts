"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { encrypt, maskSecret } from "../crypto";
import { db } from "../db";
import { API_TYPES, entityTags, models, providers } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const headersSchema = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return {} as Record<string, string>;
    try {
      const obj: unknown = JSON.parse(v);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error();
      return Object.fromEntries(Object.entries(obj).map(([k, val]) => [k, String(val)]));
    } catch {
      ctx.addIssue({ code: "custom", message: "附加请求头必须是 JSON 对象" });
      return z.NEVER;
    }
  });

const providerSchema = z.object({
  name: z.string().trim().min(1, "请输入供应商名称").max(60),
  baseUrl: z.url({ message: "Base URL 格式不正确" }).transform((v) => v.replace(/\/+$/, "")),
  apiKey: z.string().trim().optional(),
  apiTypes: z.array(z.enum(API_TYPES)).min(1, "至少选择一种 API 类型"),
  extraHeaders: headersSchema,
  enabled: z.unknown().transform((v) => v === "on"),
  tagIds: z.array(z.uuid()),
});

const MULTI = ["apiTypes", "tagIds"];

export async function createProvider(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(providerSchema, fd, MULTI);
    if (!parsed.ok) return { error: parsed.error };
    const { apiKey, tagIds, ...data } = parsed.data;
    if (!apiKey) return { error: "请输入供应商 API Key" };

    const [row] = await db
      .insert(providers)
      .values({ ...data, apiKeyEncrypted: encrypt(apiKey), apiKeyHint: maskSecret(apiKey) })
      .returning({ id: providers.id });
    await setEntityTags("provider", row.id, tagIds);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateProvider(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(providerSchema, fd, MULTI);
    if (!parsed.ok) return { error: parsed.error };
    const { apiKey, tagIds, ...data } = parsed.data;

    await Promise.all([
      db
        .update(providers)
        .set({ ...data, ...(apiKey ? { apiKeyEncrypted: encrypt(apiKey), apiKeyHint: maskSecret(apiKey) } : {}) })
        .where(eq(providers.id, id)),
      setEntityTags("provider", id, tagIds),
    ]);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function toggleProvider(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await db.update(providers).set({ enabled }).where(eq(providers.id, id));
  refresh();
}

export async function deleteProvider(id: string): Promise<void> {
  await requireAdmin();
  const modelIds = db.select({ id: models.id }).from(models).where(eq(models.providerId, id));
  // 清理供应商及其模型的标签关联（entity_tags 为多态关联，无外键），模型通过外键级联删除
  await db.batch([
    db.delete(entityTags).where(and(eq(entityTags.entityType, "model"), inArray(entityTags.entityId, modelIds))),
    db.delete(entityTags).where(and(eq(entityTags.entityType, "provider"), eq(entityTags.entityId, id))),
    db.delete(providers).where(eq(providers.id, id)),
  ]);
  refresh();
}
