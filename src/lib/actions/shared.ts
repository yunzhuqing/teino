import "server-only";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { UnauthorizedError } from "../auth";
import { db } from "../db";
import { entityTags, type TagEntityType } from "../db/schema";
import type { ActionState } from "../types";

export function formToObject(fd: FormData, multi: string[] = []): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    obj[key] = multi.includes(key) ? fd.getAll(key).map(String) : fd.get(key);
  }
  for (const key of multi) obj[key] ??= [];
  return obj;
}

export function parseForm<T extends z.ZodType>(schema: T, fd: FormData, multi: string[] = []) {
  const res = schema.safeParse(formToObject(fd, multi));
  if (res.success) return { ok: true as const, data: res.data as z.infer<T> };
  const first = res.error.issues[0];
  return { ok: false as const, error: first ? first.message : "表单校验失败" };
}

/** 覆盖式设置实体标签（batch 在 Neon HTTP 中以事务执行） */
export async function setEntityTags(entityType: TagEntityType, entityId: string, tagIds: string[]) {
  const del = db.delete(entityTags).where(and(eq(entityTags.entityType, entityType), eq(entityTags.entityId, entityId)));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) {
    await del;
    return;
  }
  await db.batch([del, db.insert(entityTags).values(unique.map((tagId) => ({ tagId, entityType, entityId })))]);
}

export function refresh() {
  revalidatePath("/", "layout");
}

const UNIQUE_VIOLATION = "23505";

export function toActionError(err: unknown): ActionState {
  if (err instanceof UnauthorizedError) return { error: err.message };
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === UNIQUE_VIOLATION) return { error: "名称已存在，请更换" };
  console.error(err);
  return { error: err instanceof Error ? err.message : "操作失败" };
}
