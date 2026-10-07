"use server";

import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { hashPassword } from "../crypto";
import { db } from "../db";
import { apiKeys, entityTags, users } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const userSchema = z.object({
  name: z.string().trim().min(1, "请输入用户名").max(60),
  email: z
    .union([z.literal(""), z.email({ message: "邮箱格式不正确" })])
    .optional()
    // 邮箱是控制台登录名，统一小写存储
    .transform((v) => v?.toLowerCase() || null),
  note: z.string().trim().max(200).optional().transform((v) => v || null),
  enabled: z.unknown().optional().transform((v) => v === "on"), // 未勾选的复选框不会出现在表单中
  tagIds: z.array(z.uuid()),
  /** 留空表示不修改（新建时即不开通控制台登录） */
  password: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().min(8, "密码至少 8 位").max(128).optional()),
});

/** 设置了密码就必须有邮箱，否则用户无从登录 */
async function toUserValues({ password, ...data }: Omit<z.infer<typeof userSchema>, "tagIds">) {
  if (password && !data.email) throw new Error("开通控制台登录需要填写邮箱");
  return password ? { ...data, passwordHash: await hashPassword(password) } : data;
}

export async function createUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(userSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
    const [row] = await db
      .insert(users)
      .values(await toUserValues(data))
      .returning({ id: users.id });
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
    const values = await toUserValues(data);
    await Promise.all([db.update(users).set(values).where(eq(users.id, id)), setEntityTags("user", id, tagIds)]);
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
