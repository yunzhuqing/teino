"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { API_TYPES, BILLING_MODES, CURRENCY_CODES, entityTags, modelPrices, models, providers } from "../db/schema";
import type { ActionState } from "../types";
import { parseForm, refresh, setEntityTags, toActionError } from "./shared";

/** 表单里的一行价格档。金额字段都是字符串，交由 numeric 列接收 */
const priceTierSchema = z.object({
  contextMin: z.coerce.number({ message: "区间起点必须是整数" }).int("区间起点必须是整数").min(0, "区间起点不能为负").max(100_000_000),
  contextMax: z
    .union([z.literal(""), z.coerce.number().int("区间终点必须是整数").min(1).max(100_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  period: z.string().trim().max(60).optional().transform((v) => v || "all"),
  inputPrice: priceField("输入单价"),
  outputPrice: priceField("输出单价"),
  cacheWritePrice: priceField("缓存创建单价"),
  cacheReadPrice: priceField("缓存命中单价"),
});

/** 单价：非负数值，最多 8 位小数，保持字符串形态交给 numeric */
function priceField(label: string) {
  return z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : "0"))
    .refine((v) => /^\d+(\.\d{1,8})?$/.test(v), `${label}必须是不超过 8 位小数的非负数`);
}

const multiplierSchema = z.record(z.string().trim().min(1).max(60), z.coerce.number().min(0, "倍率不能为负").max(1000));

/** 价格档与倍率由客户端编辑器序列化成 JSON 藏在隐藏字段里 */
function jsonField<T extends z.ZodType>(schema: T, label: string) {
  return z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: `${label}格式不正确` });
        return undefined;
      }
    })
    .pipe(schema.optional());
}

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
  billingMode: z.enum(BILLING_MODES).default("token"),
  currency: z
    .union([z.enum(CURRENCY_CODES), z.literal("")])
    .optional()
    .transform((v) => v || null),
  priorityMultipliers: jsonField(multiplierSchema, "优先级倍率"),
  /** 折扣率：(0, 1] 之间、最多 4 位小数（与 numeric(20,4) 对齐）；留空按 1（无折扣） */
  discount: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : "1"))
    .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "折扣必须是不超过 4 位小数的数字")
    .refine((v) => Number(v) > 0 && Number(v) <= 1, "折扣须在 0 到 1 之间（1 表示无折扣，0.85 表示 85 折）"),
  prices: jsonField(z.array(priceTierSchema), "价格档"),
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

/**
 * 校验计费配置的一致性。
 * Postgres 没有区间互斥约束，区间重叠只能在这里拦；否则计价时选档结果不确定。
 */
function checkBilling(data: {
  billingMode: (typeof BILLING_MODES)[number];
  currency: (typeof CURRENCY_CODES)[number] | null;
  prices?: z.infer<typeof priceTierSchema>[];
}): string | null {
  const tiers = data.prices ?? [];
  if (data.billingMode === "token" && !data.currency) return "按 token 计费时必须选择结算币种";
  for (const t of tiers) {
    if (t.contextMax !== null && t.contextMax <= t.contextMin) return `价格档区间不合法：${t.contextMin}-${t.contextMax}（终点须大于起点）`;
    if (/[.]/.test(t.period) || t.period === "") return "时段名不能为空或包含小数点";
  }
  // 同一时段内区间不允许重叠
  const byPeriod = new Map<string, z.infer<typeof priceTierSchema>[]>();
  for (const t of tiers) {
    const list = byPeriod.get(t.period);
    if (list) list.push(t);
    else byPeriod.set(t.period, [t]);
  }
  for (const [period, list] of byPeriod) {
    const sorted = [...list].sort((a, b) => a.contextMin - b.contextMin);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev.contextMax === null) return `时段 ${period} 的区间重叠：${prev.contextMin} 起的档位没有上限，后面不应再有不重叠区间`;
      if (cur.contextMin < prev.contextMax) return `时段 ${period} 的区间重叠：${prev.contextMin}-${prev.contextMax} 与 ${cur.contextMin}-${cur.contextMax ?? "∞"}`;
    }
  }
  return null;
}

/** 覆盖式写入价格档：先清空该模型的档位再插入，与 setEntityTags 的做法一致 */
async function writePrices(modelId: string, tiers: z.infer<typeof priceTierSchema>[] | undefined) {
  const del = db.delete(modelPrices).where(eq(modelPrices.modelId, modelId));
  if (!tiers || tiers.length === 0) {
    await del;
    return;
  }
  const rows = tiers.map((t) => ({
    modelId,
    contextMin: t.contextMin,
    contextMax: t.contextMax,
    period: t.period,
    inputPrice: t.inputPrice,
    outputPrice: t.outputPrice,
    cacheWritePrice: t.cacheWritePrice,
    cacheReadPrice: t.cacheReadPrice,
  }));
  await db.batch([del, db.insert(modelPrices).values(rows)]);
}

export async function createModel(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await requireAdmin();
    const parsed = parseForm(modelSchema, fd, ["tagIds"]);
    if (!parsed.ok) return { error: parsed.error };
    const { tagIds, prices, priorityMultipliers, ...data } = parsed.data;
    const apiTypeError = await checkApiType(data.providerId, data.apiType);
    if (apiTypeError) return { error: apiTypeError };
    const billingError = checkBilling({ billingMode: data.billingMode, currency: data.currency, prices });
    if (billingError) return { error: billingError };
    const [row] = await db
      .insert(models)
      .values({ ...data, priorityMultipliers: priorityMultipliers ?? {} })
      .returning({ id: models.id });
    await Promise.all([setEntityTags("model", row.id, tagIds), writePrices(row.id, prices)]);
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
    const { tagIds, prices, priorityMultipliers, ...data } = parsed.data;
    const apiTypeError = await checkApiType(data.providerId, data.apiType);
    if (apiTypeError) return { error: apiTypeError };
    const billingError = checkBilling({ billingMode: data.billingMode, currency: data.currency, prices });
    if (billingError) return { error: billingError };
    await Promise.all([
      db
        .update(models)
        .set({ ...data, priorityMultipliers: priorityMultipliers ?? {} })
        .where(eq(models.id, id)),
      setEntityTags("model", id, tagIds),
      writePrices(id, prices),
    ]);
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
    db.delete(modelPrices).where(eq(modelPrices.modelId, id)),
    db.delete(models).where(eq(models.id, id)),
  ]);
  refresh();
}
