ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
CREATE INDEX "request_logs_user_created_idx" ON "request_logs" USING btree ("user_id","created_at");