"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { generateApiKey } from "../crypto";
import { db } from "../db";
import { apiKeys, entityTags } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const expiresSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    // datetime-local 不含时区，按北京时间解析
    const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+08:00` : v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "过期时间格式不正确" });
      return z.NEVER;
    }
    return d;
  });

const baseSchema = z.object({
  name: z.string().trim().min(1, "请输入 Key 名称").max(60),
  expiresAt: expiresSchema,
  enabled: z.unknown().optional().transform((v) => v === "on"), // 未勾选的复选框不会出现在表单中
  tagIds: z.array(z.uuid()),
});

const createSchema = baseSchema.extend({ userId: z.uuid({ message: "请选择所属用户" }) });

export async function createApiKey(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(createSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    const { key, hash, prefix } = generateApiKey();
    const [row] = await db
      .insert(apiKeys)
      .values({ ...data, keyHash: hash, keyPrefix: prefix })
      .returning({ id: apiKeys.id });
    await setEntityTags("api_key", row.id, tagIds);
    refresh();
    return { ok: true, secret: key, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateApiKey(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(baseSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    await Promise.all([db.update(apiKeys).set(data).where(eq(apiKeys.id, id)), setEntityTags("api_key", id, tagIds)]);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function toggleApiKey(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await db.update(apiKeys).set({ enabled }).where(eq(apiKeys.id, id));
  refresh();
}

export async function deleteApiKey(id: string): Promise<void> {
  await requireAdmin();
  await db.batch([
    db.delete(entityTags).where(and(eq(entityTags.entityType, "api_key"), eq(entityTags.entityId, id))),
    db.delete(apiKeys).where(eq(apiKeys.id, id)),
  ]);
  refresh();
}
