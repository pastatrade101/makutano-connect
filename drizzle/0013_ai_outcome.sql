ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "outcome" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_feature_idx" ON "ai_usage" USING btree ("tenant_id","feature","created_at");
