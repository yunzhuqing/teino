"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { API_TYPES, entityTags, models, providers } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const modelSchema = z.object({
  providerId: z.uuid({ message: "请选择供应商" }),
  name: z.string().trim().min(1, "请输入模型名").max(120),
  upstreamModel: z.string().trim().max(120).optional().transform((v) => v || null),
  apiType: z
    .union([z.enum(API_TYPES), z.literal("")])
    .optional()
    .transform((v) => v || null),
  defaultMaxTokens: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number({ message: "max_tokens 必须是整数" }).int("max_tokens 必须是整数").positive("max_tokens 必须大于 0").max(1_000_000).nullable()),
  priority: z.coerce.number({ message: "优先级必须是整数" }).int("优先级必须是整数").min(-1000).max(1000),
  weight: z.coerce.number({ message: "权重必须是整数" }).int("权重必须是整数").min(0, "权重不能为负").max(10000),
  enabled: z.unknown().optional().transform((v) => v === "on"), // 未勾选的复选框不会出现在表单中
  tagIds: z.array(z.uuid()),
});

/** 模型声明的上游协议必须在供应商支持的协议之内 */
async function checkApiType(providerId: string, apiType: (typeof API_TYPES)[number] | null): Promise<string | null> {
  if (!apiType) return null;
  const [p] = await db.select({ apiTypes: providers.apiTypes }).from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!p) return "供应商不存在";
  return p.apiTypes.includes(apiType) ? null : "该供应商未声明支持此协议，请先在供应商中勾选";
}

export async function createModel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(modelSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    const apiTypeError = await checkApiType(data.providerId, data.apiType);
    if (apiTypeError) return { error: apiTypeError };
    const [row] = await db.insert(models).values(data).returning({ id: models.id });
    await setEntityTags("model", row.id, tagIds);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateModel(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(modelSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    const apiTypeError = await checkApiType(data.providerId, data.apiType);
    if (apiTypeError) return { error: apiTypeError };
    await Promise.all([db.update(models).set(data).where(eq(models.id, id)), setEntityTags("model", id, tagIds)]);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function toggleModel(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await db.update(models).set({ enabled }).where(eq(models.id, id));
  refresh();
}

export async function deleteModel(id: string): Promise<void> {
  await requireAdmin();
  await db.batch([
    db.delete(entityTags).where(and(eq(entityTags.entityType, "model"), eq(entityTags.entityId, id))),
    db.delete(models).where(eq(models.id, id)),
  ]);
  refresh();
}
