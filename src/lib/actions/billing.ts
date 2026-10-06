"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { apiKeys, billingPeriods, creditLedger, currencies } from "../db/schema";
import { formatCredit, parseCredit } from "../billing/money";
import type { ActionState } from "../types";
import { parseForm, refresh, toActionError } from "./shared";

const currencySchema = z.object({
  code: z.enum(["USD", "CNY"], { message: "请选择币种" }),
  label: z.string().trim().min(1, "请输入显示名").max(60),
  rateToBase: z
    .string()
    .trim()
    .refine((v) => /^\d+(\.\d{1,8})?$/.test(v), "汇率必须是不超过 8 位小数的正数")
    .refine((v) => Number(v) > 0, "汇率必须大于 0"),
  isBase: z.unknown().optional().transform((v) => v === "on"),
  creditRate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d+(\.\d{1,8})?$/.test(v), "积分汇率必须是不超过 8 位小数的正数"),
});

/** 新增或更新币种；主货币全局只能有一个 */
export async function upsertCurrency(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(currencySchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    const { code, ...data } = parsed.data;

    // 主货币互斥：勾选新的主货币时先把原来的取消
    if (data.isBase) await db.update(currencies).set({ isBase: false }).where(eq(currencies.isBase, true));

    await db
      .insert(currencies)
      .values({ code, ...data })
      .onConflictDoUpdate({ target: currencies.code, set: data });
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

const periodSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入时段名")
    .max(60)
    .refine((v) => v !== "all", "all 是内置的兜底档，请换一个名字")
    .refine((v) => !/[.]/.test(v), "时段名不能包含小数点"),
  startMinute: z.coerce.number({ message: "开始时间不合法" }).int().min(0).max(1439),
  endMinute: z.coerce.number({ message: "结束时间不合法" }).int().min(1).max(1440),
  timezone: z.string().trim().min(1, "请输入时区").max(60),
  enabled: z.unknown().optional().transform((v) => v === "on"),
});

export async function upsertPeriod(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(periodSchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    await db
      .insert(billingPeriods)
      .values(parsed.data)
      .onConflictDoUpdate({ target: billingPeriods.name, set: parsed.data });
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}

export async function togglePeriod(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await db.update(billingPeriods).set({ enabled }).where(eq(billingPeriods.id, id));
  refresh();
}

export async function deletePeriod(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(billingPeriods).where(eq(billingPeriods.id, id));
  refresh();
}

const topUpSchema = z.object({
  apiKeyId: z.uuid({ message: "请选择 API Key" }),
  amount: z
    .string()
    .trim()
    .refine((v) => /^-?\d+(\.\d{1,6})?$/.test(v), "充值数额必须是不超过 6 位小数的数字")
    .refine((v) => Number(v) !== 0, "充值数额不能为 0"),
  note: z.string().trim().max(200).optional().transform((v) => v || null),
});

/**
 * 给 API Key 充值（或人工调整，填负数即为扣减）。
 * 与消费扣减同样用单条原子 UPDATE + 流水，避免读-改-写。
 */
export async function topUpCredits(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(topUpSchema, fd);
    if (!parsed.ok) return { error: parsed.error };
    const { apiKeyId, amount, note } = parsed.data;
    const delta = parseCredit(amount);

    const [row] = await db
      .update(apiKeys)
      // 原子增减：直接让数据库做加法，避免「先读后写」在并发下丢失更新
      .set({ creditBalance: sql`${apiKeys.creditBalance} + ${formatCredit(delta)}::numeric` })
      .where(eq(apiKeys.id, apiKeyId))
      .returning({ creditBalance: apiKeys.creditBalance, userId: apiKeys.userId });
    if (!row) return { error: "API Key 不存在" };

    await db.insert(creditLedger).values({
      apiKeyId,
      userId: row.userId,
      entryType: delta > 0n ? "topup" : "adjust",
      amount: formatCredit(delta),
      balanceAfter: row.creditBalance,
      note,
    });
    refresh();
    return { ok: true, ts: Date.now() };
  } catch (err) {
    return toActionError(err);
  }
}
