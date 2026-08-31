-- The three facts a traveller checks before reading a word of the description.
--
-- Each is a BOOLEAN a vendor ticks, not prose parsed out of a summary field.
-- "Can this be customised", "can I come alone" and "can I start any day" decide
-- whether a listing is even relevant, and a traveller should not have to infer
-- them from a paragraph -- nor should the page claim them by guessing.
--
-- DEFAULT FALSE, so an existing listing asserts nothing it was never asked. The
-- page renders a feature only when it is true, so silence stays silence rather
-- than becoming a claim the operator did not make.
--
-- Deliberately NOT here: a comfort level (Budget / Mid-range / Luxury). That is
-- already a travel style, and a tour carrying both would eventually carry two
-- different answers.

ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "customisable" boolean NOT NULL DEFAULT false;
ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "solo_friendly" boolean NOT NULL DEFAULT false;
ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "starts_any_day" boolean NOT NULL DEFAULT false;

-- An index behind tours.primary_category_id.
--
-- Not for reading — for WRITING. tour_categories is referenced with ON DELETE
-- RESTRICT, and without an index Postgres enforces that by sequentially scanning
-- `tours` and locking as it goes. Any attempt to retire or remove a category
-- then queues behind every concurrent insert into the busiest table in the
-- schema. The test suite found this: a delete that takes 500ms in isolation had
-- not returned after two minutes under parallel load.
--
-- Partial, because a listing with no category is not a candidate for the check.
CREATE INDEX IF NOT EXISTS "tours_primary_category_idx"
	ON "tours" ("primary_category_id") WHERE "primary_category_id" IS NOT NULL;
