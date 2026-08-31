-- Two discovery axes for a Tanzania-only marketplace: WHERE (destination) and
-- WHAT KIND OF TRIP (travel style). Tours connect to both, many-to-many.
--
-- Travel style was a free-text column on tours, which is exactly how a taxonomy
-- rots: "Luxury", "Luxury Safari", "luxury trip" and "Premium Luxury" all become
-- separate filters that each match a fraction of the inventory. It becomes a
-- platform-managed table for the same reason destinations are.

/* ------------------------------------------------------- destination types -- */

-- destination_type stops being a Postgres enum and becomes text with a CHECK.
--
-- Not a stylistic preference. Postgres refuses to USE a newly added enum value in
-- the same transaction that added it, and Drizzle applies every pending migration
-- in one transaction — so "add three categories and seed rows that use them"
-- cannot be expressed as migrations at all while this is an enum. It fails with
-- `unsafe use of new value "HERITAGE_SITE"`, and the only workarounds are running
-- the migrator twice or splitting the work across deploys.
--
-- This is a growing taxonomy on a table with almost no rows. A CHECK gives the
-- same integrity, and adding a category later is one line instead of a puzzle
-- about transaction boundaries.

ALTER TABLE "destinations" ALTER COLUMN "destination_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "destinations"
	ALTER COLUMN "destination_type" TYPE text USING "destination_type"::text;--> statement-breakpoint
ALTER TABLE "destinations" ALTER COLUMN "destination_type" SET DEFAULT 'OTHER';--> statement-breakpoint

ALTER TABLE "destinations" DROP CONSTRAINT IF EXISTS "destinations_type_check";--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_type_check" CHECK ("destination_type" IN (
	'NATIONAL_PARK', 'GAME_RESERVE', 'CONSERVATION_AREA', 'MOUNTAIN', 'ISLAND',
	'BEACH', 'CITY', 'CULTURAL_AREA', 'LAKE', 'HERITAGE_SITE', 'FOREST',
	'MARINE_AREA', 'OTHER'
));--> statement-breakpoint

-- The enum type itself is left in place: dropping it would fail while anything
-- still references it, and an unused type costs nothing.

/* ------------------------------------------------ destination curation ---- */

-- Seed broadly, feature selectively. The directory can know eighty places while
-- the homepage shows eight, and which eight is an editorial decision rather than
-- a consequence of what happens to be in the table.
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "destinations" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "destinations_featured_idx"
	ON "destinations" USING btree ("sort_order", "name")
	WHERE "is_featured" AND "status" = 'PUBLISHED';--> statement-breakpoint

/* ----------------------------------------------------------- travel styles -- */

CREATE TABLE IF NOT EXISTS "travel_styles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"description" text,
	-- A theme icon name, not an uploaded asset: these render inline in filters
	-- and a round trip to storage for a chip would be silly.
	"icon" text,
	"hero_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "travel_styles_slug_idx" ON "travel_styles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travel_styles_featured_idx"
	ON "travel_styles" USING btree ("sort_order", "name") WHERE "is_featured" AND "is_active";--> statement-breakpoint

-- A tour is legitimately several things at once — a luxury honeymoon safari is
-- all three — so this is many-to-many rather than a category column.
CREATE TABLE IF NOT EXISTS "tour_travel_styles" (
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
	-- RESTRICT: a style tours are tagged with cannot be deleted from under them.
	-- Deactivate it instead, exactly as with destinations.
	"travel_style_id" uuid NOT NULL REFERENCES "travel_styles"("id") ON DELETE restrict,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_travel_styles_pkey" PRIMARY KEY ("tour_id","travel_style_id")
);--> statement-breakpoint

-- The composite PK serves tour -> styles. This serves the other direction, which
-- is the /travel-styles/<slug> page.
CREATE INDEX IF NOT EXISTS "tour_travel_styles_style_idx"
	ON "tour_travel_styles" USING btree ("travel_style_id","sort_order");--> statement-breakpoint

/* ------------------------------------------------------- canonical slugs --- */

-- The first seed used short slugs. The directory now names places the way the
-- park authority does, so the public URL becomes /destinations/serengeti-national-park.
--
-- UPDATE rather than insert-a-second-row: a duplicate would be exactly the
-- fragmentation this table exists to prevent, and any tour already linked keeps
-- its link because the id does not change. Guarded so a re-run is a no-op and so
-- it cannot collide with a row that already holds the new slug.
UPDATE "destinations" d SET "slug" = v."new", "updated_at" = now()
FROM (VALUES
	('serengeti', 'serengeti-national-park', 'Serengeti National Park'),
	('ngorongoro', 'ngorongoro-conservation-area', 'Ngorongoro Conservation Area'),
	('tarangire', 'tarangire-national-park', 'Tarangire National Park'),
	('lake-manyara', 'lake-manyara-national-park', 'Lake Manyara National Park'),
	('nyerere', 'nyerere-national-park', 'Nyerere National Park'),
	('ruaha', 'ruaha-national-park', 'Ruaha National Park'),
	('kilimanjaro', 'mount-kilimanjaro', 'Mount Kilimanjaro')
) AS v("old","new","name")
WHERE d."slug" = v."old" AND NOT EXISTS (SELECT 1 FROM "destinations" x WHERE x."slug" = v."new");--> statement-breakpoint

UPDATE "destinations" d SET "name" = v."name"
FROM (VALUES
	('serengeti-national-park', 'Serengeti National Park'),
	('ngorongoro-conservation-area', 'Ngorongoro Conservation Area'),
	('tarangire-national-park', 'Tarangire National Park'),
	('lake-manyara-national-park', 'Lake Manyara National Park'),
	('nyerere-national-park', 'Nyerere National Park'),
	('ruaha-national-park', 'Ruaha National Park'),
	('mount-kilimanjaro', 'Mount Kilimanjaro')
) AS v("slug","name")
WHERE d."slug" = v."slug";--> statement-breakpoint

/* ------------------------------------------- Tanzania-only marketplace ----- */

-- Kenya, Uganda and Rwanda were seeded when this was an East Africa marketplace.
-- It is Tanzania-only now, so they are DEACTIVATED rather than deleted: the FKs
-- are RESTRICT, deletion would fail the moment anything referenced them, and a
-- direction that changes back should not need the rows recreated.
UPDATE "destinations" SET "status" = 'ARCHIVED', "updated_at" = now()
WHERE "country_id" IN (SELECT "id" FROM "countries" WHERE "slug" <> 'tanzania');--> statement-breakpoint

UPDATE "countries" SET "is_active" = false, "updated_at" = now() WHERE "slug" <> 'tanzania';
