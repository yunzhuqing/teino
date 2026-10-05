CREATE TYPE "public"."api_type" AS ENUM('openai_chat', 'openai_responses', 'anthropic_messages');--> statement-breakpoint
CREATE TYPE "public"."tag_entity_type" AS ENUM('provider', 'model', 'user', 'api_key');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"tag_id" uuid NOT NULL,
	"entity_type" "tag_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "entity_tags_tag_id_entity_type_entity_id_pk" PRIMARY KEY("tag_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"name" text NOT NULL,
	"upstream_model" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_hint" text DEFAULT '' NOT NULL,
	"api_types" "api_type"[] DEFAULT '{}' NOT NULL,
	"extra_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid,
	"user_id" uuid,
	"provider_id" uuid,
	"model_id" uuid,
	"api_type" "api_type" NOT NULL,
	"model" text NOT NULL,
	"stream" boolean DEFAULT false NOT NULL,
	"status" integer NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#8b5cf6' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"note" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entity_tags_entity_idx" ON "entity_tags" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_name_uq" ON "models" USING btree ("provider_id","name");--> statement-breakpoint
CREATE INDEX "models_name_idx" ON "models" USING btree ("name");--> statement-breakpoint
CREATE INDEX "request_logs_created_idx" ON "request_logs" USING btree ("created_at");