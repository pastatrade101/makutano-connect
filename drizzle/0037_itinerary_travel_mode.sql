-- HOW you get from one stop to the next.
--
-- A safari itinerary is not one kind of movement. "Arusha to the Serengeti" is a
-- six-hour drive or a fifty-minute flight, and which one it is changes the price,
-- the day, and whether the trip is even suitable for somebody. Drawing every leg
-- as the same line, as the route map did, quietly asserts they are equivalent.
--
-- Three values, because there are three: you drive, you fly, or you take a boat.
-- NULL means the operator has not said, and the map draws a neutral line rather
-- than guessing at one.
--
-- Text with a CHECK rather than an enum, for the reason destination_type is:
-- Postgres refuses to USE a new enum value in the transaction that adds it, and
-- drizzle applies pending migrations together.

ALTER TABLE "tour_itinerary_days" ADD COLUMN IF NOT EXISTS "travel_mode" text;
ALTER TABLE "tour_itinerary_days" DROP CONSTRAINT IF EXISTS "tour_itinerary_days_travel_mode_check";
ALTER TABLE "tour_itinerary_days" ADD CONSTRAINT "tour_itinerary_days_travel_mode_check"
	CHECK ("travel_mode" IS NULL OR "travel_mode" IN ('DRIVE', 'FLY', 'BOAT'));
