"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { tags } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, toActionError } from "./shared";

const tagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入标签名")
    .max(40, "标签名过长")
    .regex(/^[^,\s]+$/, "标签名不能包含空格或逗号"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确"),
  description: z.string().trim().max(200).optional().transform((v) => v || null),
});

export async function createTag(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(tagSchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    await db.insert(tags).values(parsed.data);
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateTag(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(tagSchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    await db.update(tags).set(parsed.data).where(eq(tags.id, id));
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteTag(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(tags).where(eq(tags.id, id));
  refresh();
}
