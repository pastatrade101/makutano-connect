-- The idempotency column shipped in the same breath as 0010, but 0010 had already
-- been applied by then and drizzle replays by timestamp, never by content — so an
-- existing database would silently never get it. Guarded DDL: a no-op where 0010
-- already created it, the real fix everywhere else.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_link_submission_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_order_link_submission_key" ON "orders" USING btree ("tenant_id","order_link_id","order_link_submission_token");
