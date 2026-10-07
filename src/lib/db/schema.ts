import type { PriceSnapshot } from "../billing/pricing";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const API_TYPES = ["openai_chat", "openai_responses", "anthropic_messages"] as const;
export type ApiType = (typeof API_TYPES)[number];

export const TAG_ENTITY_TYPES = ["provider", "model", "user", "api_key"] as const;
export type TagEntityType = (typeof TAG_ENTITY_TYPES)[number];

/** token：价格字段是真实货币金额；credit：价格字段是虚拟积分 */
export const BILLING_MODES = ["token", "credit"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export const CURRENCY_CODES = ["USD", "CNY"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const LEDGER_ENTRY_TYPES = ["topup", "consume", "adjust"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** 价格档与 `all` 时段：命中不到具体时段窗口时使用的兜底档 */
export const FALLBACK_PERIOD = "all";

export const apiTypeEnum = pgEnum("api_type", API_TYPES);
export const tagEntityTypeEnum = pgEnum("tag_entity_type", TAG_ENTITY_TYPES);
export const billingModeEnum = pgEnum("billing_mode", BILLING_MODES);
export const currencyCodeEnum = pgEnum("currency_code", CURRENCY_CODES);
export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", LEDGER_ENTRY_TYPES);

/**
 * 金额精度约定：单价与费用 8 位小数（足够表达 $0.1/M 这类单价），积分 6 位小数。
 * numeric 在 Drizzle 中读写都是 string，禁止直接 Number() 参与运算——统一走 src/lib/billing/money.ts 的 BigInt 定标。
 */
const AMOUNT_PRECISION = 20;
const AMOUNT_SCALE = 8;
const CREDIT_SCALE = 6;

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#8b5cf6"),
  description: text("description"),
  createdAt: createdAt(),
});

/** 币种与汇率。费用一律以模型原币记录，展示时才按本表折算 */
export const currencies = pgTable("currencies", {
  code: currencyCodeEnum("code").primaryKey(),
  label: text("label").notNull(),
  /** 1 单位本币种 = 多少主货币 */
  rateToBase: numeric("rate_to_base", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("1"),
  isBase: boolean("is_base").notNull().default(false),
  /** 仅主货币行有意义：1 单位主货币 = 多少积分。为空表示不接受积分结算 */
  creditRate: numeric("credit_rate", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }),
  updatedAt: updatedAt(),
});

/** 计费时段（高峰/低谷）。价格档的 period 字段按 name 关联；不存在名为 `all` 的行，它是代码里的兜底 */
export const billingPeriods = pgTable(
  "billing_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    /** 当日分钟数 0-1439，含起点不含终点；start > end 表示跨午夜 */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    /** IANA 时区名，判定时以此为准（网关与运营可能不在同一时区） */
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("billing_periods_enabled_idx").on(t.enabled)],
);

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** AES-256-GCM 加密后的上游密钥 */
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  apiKeyHint: text("api_key_hint").notNull().default(""),
  apiTypes: apiTypeEnum("api_types").array().notNull().default([]),
  extraHeaders: jsonb("extra_headers").$type<Record<string, string>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    /** 客户端请求时使用的模型名 */
    name: text("name").notNull(),
    /** 发往上游的真实模型名，为空则与 name 相同 */
    upstreamModel: text("upstream_model"),
    /** 调用上游使用的协议；为空则沿用请求协议（透传）。与请求协议不同时网关自动转换 */
    apiType: apiTypeEnum("api_type"),
    /** 转换为 Anthropic Messages 且调用方未传 max_tokens 时使用；为空则用全局默认值 */
    defaultMaxTokens: integer("default_max_tokens"),
    /** 数值越大优先级越高 */
    priority: integer("priority").notNull().default(0),
    /** 同优先级内的流量权重 */
    weight: integer("weight").notNull().default(100),
    /** 计费模式：token 按真实货币、credit 按虚拟积分。注意与上面的 priority 无关 */
    billingMode: billingModeEnum("billing_mode").notNull().default("token"),
    /** token 模式的结算币种；credit 模式为空 */
    currency: currencyCodeEnum("currency"),
    /** 请求优先级档位 -> 倍率，如 {"standard":1,"priority":2,"batch":0.5}；未声明的档位按 1 计 */
    priorityMultipliers: jsonb("priority_multipliers").$type<Record<string, number>>().notNull().default({}),
    /** 供应商给的折扣率：1 = 无折扣，0.85 = 85 折。与倍率一起在合计后应用；同名模型在不同供应商下可各不相同 */
    discount: numeric("discount", { precision: AMOUNT_PRECISION, scale: 4 }).notNull().default("1"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("models_provider_name_uq").on(t.providerId, t.name),
    index("models_name_idx").on(t.name),
  ],
);

/**
 * 模型价格档：一行 = 一个「上下文区间 × 时段」的四个单价，单位是「每 100 万 token」。
 * 上下文区间为闭开区间 [context_min, context_max)，context_max 为空表示无上限。
 * 区间不允许重叠（Postgres 无原生互斥约束，由 server action 校验；唯一索引只兜底精确重复）。
 */
export const modelPrices = pgTable(
  "model_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelId: uuid("model_id")
      .notNull()
      .references(() => models.id, { onDelete: "cascade" }),
    contextMin: integer("context_min").notNull().default(0),
    contextMax: integer("context_max"),
    /** 对应 billing_periods.name，FALLBACK_PERIOD 为兜底档 */
    period: text("period").notNull().default(FALLBACK_PERIOD),
    inputPrice: numeric("input_price", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("0"),
    outputPrice: numeric("output_price", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("0"),
    cacheWritePrice: numeric("cache_write_price", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("0"),
    cacheReadPrice: numeric("cache_read_price", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("0"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("model_prices_model_idx").on(t.modelId),
    uniqueIndex("model_prices_tier_uq").on(t.modelId, t.period, t.contextMin),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").unique(),
  note: text("note"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** 积分余额（钱包挂在 Key 级，不是用户级）。允许扣成负数：已服务的请求必须记账 */
    creditBalance: numeric("credit_balance", { precision: AMOUNT_PRECISION, scale: CREDIT_SCALE }).notNull().default("0"),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);

export const entityTags = pgTable(
  "entity_tags",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    entityType: tagEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
    index("entity_tags_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const requestLogs = pgTable(
  "request_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => providers.id, { onDelete: "set null" }),
    modelId: uuid("model_id").references(() => models.id, { onDelete: "set null" }),
    apiType: apiTypeEnum("api_type").notNull(),
    /** 发生协议转换时记录上游协议；同协议透传为空 */
    upstreamApiType: apiTypeEnum("upstream_api_type"),
    model: text("model").notNull(),
    stream: boolean("stream").notNull().default(false),
    status: integer("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** 命中缓存的输入 token（单独计价，不计入 input_tokens） */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    /** 写入缓存的输入 token（单独计价，不计入 input_tokens） */
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** 按模型原币计算的费用 */
    costOriginal: numeric("cost_original", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }).notNull().default("0"),
    /** cost_original 的币种；credit 模式为空 */
    currency: currencyCodeEnum("currency"),
    /** 实际扣除的积分（token 模式按汇率折算而来） */
    creditsCharged: numeric("credits_charged", { precision: AMOUNT_PRECISION, scale: CREDIT_SCALE }).notNull().default("0"),
    /** 命中的价格档，便于事后审计；档位被删则置空 */
    priceTierId: uuid("price_tier_id").references(() => modelPrices.id, { onDelete: "set null" }),
    /** 结算时命中的时段名 */
    period: text("period"),
    /** 请求声明的优先级档位 */
    priorityTier: text("priority_tier"),
    /** 结算时套用的倍率 */
    multiplier: numeric("multiplier", { precision: AMOUNT_PRECISION, scale: 4 }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("request_logs_created_idx").on(t.createdAt),
    index("request_logs_key_created_idx").on(t.apiKeyId, t.createdAt),
  ],
);

/** 积分流水：充值、消费、人工调整各一行，amount 正入负出 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    /** 冗余归因，便于按用户聚合 */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** 消费对应的请求日志；日志被清理后置空 */
    requestLogId: uuid("request_log_id").references(() => requestLogs.id, { onDelete: "set null" }),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    amount: numeric("amount", { precision: AMOUNT_PRECISION, scale: CREDIT_SCALE }).notNull(),
    balanceAfter: numeric("balance_after", { precision: AMOUNT_PRECISION, scale: CREDIT_SCALE }).notNull(),
    /** 消费时的原币金额，用于对账 */
    amountOriginal: numeric("amount_original", { precision: AMOUNT_PRECISION, scale: AMOUNT_SCALE }),
    currency: currencyCodeEnum("currency"),
    /** 结算时的档位/倍率/时段快照，价格后续被改动也能还原当时的算法；也是计费明细的唯一凭据 */
    priceSnapshot: jsonb("price_snapshot").$type<PriceSnapshot>(),
    note: text("note"),
    createdAt: createdAt(),
  },
  // request_log_id 供日志详情反查明细，(api_key_id, created_at) 供按 Key 分页查余额流水
  (t) => [index("credit_ledger_key_created_idx").on(t.apiKeyId, t.createdAt), index("credit_ledger_request_idx").on(t.requestLogId)],
);

export type Tag = typeof tags.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Model = typeof models.$inferSelect;
export type ModelPrice = typeof modelPrices.$inferSelect;
export type Currency = typeof currencies.$inferSelect;
export type BillingPeriod = typeof billingPeriods.$inferSelect;
export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type RequestLog = typeof requestLogs.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
