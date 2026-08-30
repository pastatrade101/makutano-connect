-- A cancelled trip must not block the booking forever.
--
-- 0016 made booking_id unique outright, which is right for LIVE trips — two
-- departures for one sale is always a mistake. But it also meant that once a
-- trip was cancelled (a hotel fell through, the booking was stood down and
-- later revived) the sale could never be handed to operations again, and
-- createTripFromBooking would keep returning the dead trip as though it were
-- current.
--
-- Partial index: at most one trip per booking that is not cancelled.

DROP INDEX IF EXISTS "trips_booking_key";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "trips_booking_live_key"
	ON "trips" USING btree ("booking_id")
	WHERE "status" <> 'CANCELLED';
