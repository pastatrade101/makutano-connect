-- A quotation the source system deleted has to be able to disappear here too.
--
-- The mirror is a one-way push: Goldfinch tells Connect about quotations that
-- EXIST, and has no way to say "this one is gone". So deleting sixteen
-- quotations there left sixteen on the work list here, and no amount of
-- re-syncing would have cleared them.
--
-- Soft, like bookings: a quotation may be the provenance of a booking — the
-- record of what was agreed and at what price — so it is hidden, never
-- destroyed. quotation_versions and payment_requests cascade from it.
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotations_live_idx" ON "quotations" USING btree ("tenant_id","status","created_at") WHERE "deleted_at" IS NULL;
