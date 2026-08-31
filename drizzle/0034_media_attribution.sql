-- Where an image came from, and what it obliges us to say.
--
-- Destination photography is sourced from Wikimedia Commons, which is free to
-- use but almost entirely licensed CC BY / CC BY-SA — attribution is a CONDITION
-- of use, not a courtesy. Storing it beside the object is the only way the page
-- can render it, and the only way anyone can later audit what we published.
--
-- Nullable throughout: an operator's own photograph of their own trip needs none
-- of this, and forcing a value would invite meaningless ones.
ALTER TABLE "media"
	-- e.g. "Photo by Jane Doe" — rendered under the image.
	ADD COLUMN IF NOT EXISTS "attribution" text,
	-- e.g. "CC BY-SA 4.0". Kept as the licence's short name so a human can check it.
	ADD COLUMN IF NOT EXISTS "license" text,
	-- The file's page, so the original and its full terms stay one click away.
	ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint

-- Finding everything that carries an obligation should not be a table scan.
CREATE INDEX IF NOT EXISTS "media_licensed_idx" ON "media" USING btree ("license") WHERE "license" IS NOT NULL;
