CREATE TYPE "public"."billing_mode" AS ENUM('token', 'credit');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'CNY');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('topup', 'consume', 'adjust');--> statement-breakpoint
CREATE TABLE "billing_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_periods_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"user_id" uuid,
	"request_log_id" uuid,
	"entry_type" "ledger_entry_type" NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"balance_after" numeric(20, 6) NOT NULL,
	"amount_original" numeric(20, 8),
	"currency" "currency_code",
	"price_snapshot" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" "currency_code" PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"rate_to_base" numeric(20, 8) DEFAULT '1' NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"credit_rate" numeric(20, 8),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"context_min" integer DEFAULT 0 NOT NULL,
	"context_max" integer,
	"period" text DEFAULT 'all' NOT NULL,
	"input_price" numeric(20, 8) DEFAULT '0' NOT NULL,
	"output_price" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cache_write_price" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cache_read_price" numeric(20, 8) DEFAULT '0' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "credit_balance" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "billing_mode" "billing_mode" DEFAULT 'token' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "currency" "currency_code";--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "priority_multipliers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "cost_original" numeric(20, 8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "currency" "currency_code";--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "credits_charged" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "price_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "period" text;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "priority_tier" text;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "multiplier" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_request_log_id_request_logs_id_fk" FOREIGN KEY ("request_log_id") REFERENCES "public"."request_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_prices" ADD CONSTRAINT "model_prices_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_periods_enabled_idx" ON "billing_periods" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "credit_ledger_key_created_idx" ON "credit_ledger" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "model_prices_model_idx" ON "model_prices" USING btree ("model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_prices_tier_uq" ON "model_prices" USING btree ("model_id","period","context_min");--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_price_tier_id_model_prices_id_fk" FOREIGN KEY ("price_tier_id") REFERENCES "public"."model_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_logs_key_created_idx" ON "request_logs" USING btree ("api_key_id","created_at");