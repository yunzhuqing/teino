ALTER TABLE "models" ADD COLUMN "api_type" "api_type";--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "default_max_tokens" integer;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "upstream_api_type" "api_type";