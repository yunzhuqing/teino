"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { apiKeys, entityTags, users } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const userSchema = z.object({
  name: z.string().trim().min(1, "请输入用户名").max(60),
  email: z
    .union([z.literal(""), z.email({ message: "邮箱格式不正确" })])
    .optional()
    .transform((v) => v || null),
  note: z.string().trim().max(200).optional().transform((v) => v || null),
  enabled: z.unknown().optional().transform((v) => v === "on"), // 未勾选的复选框不会出现在表单中
  tagIds: z.array(z.uuid()),
});

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(userSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    const [row] = await db.insert(users).values(data).returning({ id: users.id });
    await setEntityTags("user", row.id, tagIds);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateUser(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(userSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    await Promise.all([db.update(users).set(data).where(eq(users.id, id)), setEntityTags("user", id, tagIds)]);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function toggleUser(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await db.update(users).set({ enabled }).where(eq(users.id, id));
  refresh();
}

export async function deleteUser(id: string): Promise<void> {
  await requireAdmin();
  const keyIds = db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.userId, id));
  await db.batch([
    db
      .delete(entityTags)
      .where(
        or(
          and(eq(entityTags.entityType, "user"), eq(entityTags.entityId, id)),
          and(eq(entityTags.entityType, "api_key"), inArray(entityTags.entityId, keyIds)),
        ),
      ),
    db.delete(users).where(eq(users.id, id)),
  ]);
  refresh();
}
