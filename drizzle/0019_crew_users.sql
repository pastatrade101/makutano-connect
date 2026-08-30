-- Crew who log in, and crew who came from somewhere else.
--
-- CREW is the only role whose READS are row-limited: everyone else sees the
-- whole tenant, crew see the trips they are personally on. That is enforced in
-- listTrips, not by hiding controls.

ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'CREW';--> statement-breakpoint

-- A synced person is keyed on the source id so re-syncing updates rather than
-- duplicates. Somebody added by hand in the portal has neither column, and the
-- sync must never touch them — they were typed in precisely because the source
-- did not have them.
ALTER TABLE "crew" ADD COLUMN IF NOT EXISTS "external_reference" text;--> statement-breakpoint
ALTER TABLE "crew" ADD COLUMN IF NOT EXISTS "external_source" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_source_idx" ON "crew" USING btree ("tenant_id","external_source","external_reference");
