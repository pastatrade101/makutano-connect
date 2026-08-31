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
