import {
  boolean,
  index,
  integer,
  jsonb,
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

export const apiTypeEnum = pgEnum("api_type", API_TYPES);
export const tagEntityTypeEnum = pgEnum("tag_entity_type", TAG_ENTITY_TYPES);

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
    /** 数值越大优先级越高 */
    priority: integer("priority").notNull().default(0),
    /** 同优先级内的流量权重 */
    weight: integer("weight").notNull().default(100),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("models_provider_name_uq").on(t.providerId, t.name),
    index("models_name_idx").on(t.name),
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
    model: text("model").notNull(),
    stream: boolean("stream").notNull().default(false),
    status: integer("status").notNull(),
    attempts: integer("attempts").notNull().default(1),
    latencyMs: integer("latency_ms").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("request_logs_created_idx").on(t.createdAt)],
);

export type Tag = typeof tags.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Model = typeof models.$inferSelect;
export type User = typeof users.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type RequestLog = typeof requestLogs.$inferSelect;
