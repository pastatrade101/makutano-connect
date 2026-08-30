-- Deleting an enquiry or a booking hides it; it does not destroy it.
--
-- A hard delete here cascades into booking_items, booking_travelers,
-- booking_notes, booking_status_history, payment_requests and the whole TRIP,
-- and it orphans payments (payments.booking_id is ON DELETE SET NULL) — money
-- in the ledger that no longer knows what it was for. Somebody tidying their
-- list on a phone must not be able to do that with a swipe.
--
-- Nullable timestamp, no status change: the booking keeps whatever commercial
-- status it had, so restoring it puts back exactly what was there.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_requests" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint

-- Every list is "the ones that are not deleted", so the partial indexes carry
-- the live rows only — which is also the set that keeps growing.
CREATE INDEX IF NOT EXISTS "bookings_live_idx" ON "bookings" USING btree ("tenant_id","status","created_at") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_requests_live_idx" ON "booking_requests" USING btree ("tenant_id","status","created_at") WHERE "deleted_at" IS NULL;
