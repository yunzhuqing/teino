"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { entityTags, models } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

const modelSchema = z.object({
  providerId: z.uuid({ message: "请选择供应商" }),
  name: z.string().trim().min(1, "请输入模型名").max(120),
  upstreamModel: z.string().trim().max(120).optional().transform((v) => v || null),
  priority: z.coerce.number({ message: "优先级必须是整数" }).int("优先级必须是整数").min(-1000).max(1000),
  weight: z.coerce.number({ message: "权重必须是整数" }).int("权重必须是整数").min(0, "权重不能为负").max(10000),
  enabled: z.unknown().transform((v) => v === "on"),
  tagIds: z.array(z.uuid()),
});

export async function createModel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(modelSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, ...data } = parsed.data;
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
