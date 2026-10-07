"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "../auth";
import { generateApiKey } from "../crypto";
import { db } from "../db";
import { apiKeys, entityTags } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, toActionError } from "./shared";

/**
 * 用户控制台自助管理 Key。与管理端的区别：
 * - userId 一律取自会话，所有写操作都带 user_id 条件，防止改到他人的 Key；
 * - 不能设置标签（标签决定可路由的上游，属于管理员的权限）、不能充值；
 * - 新 Key 不继承任何 Key 级标签，路由范围只由用户标签决定。
 */

const MAX_KEYS_PER_USER = 20;

const keySchema = z.object({
  name: z.string().trim().min(1, "请输入 Key 名称").max(60),
  expiresAt: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+08:00` : v); // datetime-local 按北京时间解析
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "过期时间格式不正确" });
        return z.NEVER;
      }
      return d;
    }),
});

function ownKey(userId: string, id: string) {
  return and(eq(apiKeys.id, id), eq(apiKeys.userId, userId));
}

export async function createMyApiKey(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = parseForm(keySchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    const existing = await db.$count(apiKeys, eq(apiKeys.userId, user.id));
    if (existing >= MAX_KEYS_PER_USER) return { error: `最多只能创建 ${MAX_KEYS_PER_USER} 个 Key` };
    const { key, hash, prefix } = generateApiKey();
    await db.insert(apiKeys).values({ ...parsed.data, userId: user.id, keyHash: hash, keyPrefix: prefix });
    refresh();
    return { ok: true, secret: key, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateMyApiKey(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const parsed = parseForm(keySchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    await db.update(apiKeys).set(parsed.data).where(ownKey(user.id, id));
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function toggleMyApiKey(id: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  await db.update(apiKeys).set({ enabled }).where(ownKey(user.id, id));
  refresh();
}

export async function deleteMyApiKey(id: string): Promise<ActionState> {
  try {
    const user = await requireUser();
    const [owned] = await db.select({ balance: apiKeys.creditBalance }).from(apiKeys).where(ownKey(user.id, id)).limit(1);
    if (!owned) return { error: "Key 不存在" };
    // 积分挂在 Key 上，删除会连同余额与流水一起丢失
    if (Number(owned.balance) !== 0) return { error: "该 Key 仍有积分余额，不能删除；如需停用请关闭开关" };
    await db.batch([
      db.delete(entityTags).where(and(eq(entityTags.entityType, "api_key"), eq(entityTags.entityId, id))),
      db.delete(apiKeys).where(ownKey(user.id, id)),
    ]);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}
