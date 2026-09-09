-- At most one live booking per quotation.
--
-- The application now elects a single winner (advisory lock on the enquiry plus a
-- conditional status claim), but the application is not the last word: POST
-- /api/v1/bookings takes an arbitrary quotation_id, and the Goldfinch mirror creates
-- bookings on its own path. This is the backstop that holds whatever the callers do.
--
-- Deliberately NOT unique on booking_request_id. "One enquiry, one booking" is not
-- yet a settled product rule — split parties, rebookings and the Goldfinch promotion
-- all make it ambiguous — and a constraint is the wrong place to guess.
--
-- Partial, so the many bookings with no quotation behind them are unaffected, and so
-- a soft-deleted booking does not block re-creating one.
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_one_per_quotation"
  ON "bookings" ("quotation_id")
  WHERE "quotation_id" IS NOT NULL AND "deleted_at" IS NULL;
