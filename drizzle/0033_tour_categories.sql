-- The third discovery axis: WHAT kind of product this is.
--
--   DESTINATION = where            (Serengeti, Zanzibar)
--   CATEGORY    = what             (Safari, Beach & Island)
--   TRAVEL STYLE = how             (Luxury, Honeymoon, Family)
--
-- The previous seed put all three in one table, which is why "Safari" and
-- "Luxury" sat side by side as if they were the same kind of thing. They are
-- not: every tour is exactly one product category and several styles, and a
-- traveller reads them differently. Splitting them now costs one migration;
-- splitting them after operators have tagged inventory costs a data migration
-- and a broken navigation.
--
-- Nothing references travel_styles yet — no tour has been published — so the
-- corrections below rewrite the seed rather than migrating live tags.

/* ------------------------------------------------------------- categories -- */

CREATE TABLE IF NOT EXISTS "tour_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"description" text,
	"icon" text,
	"hero_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tour_categories_slug_idx" ON "tour_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_categories_featured_idx"
	ON "tour_categories" USING btree ("sort_order", "name") WHERE "is_featured" AND "is_active";--> statement-breakpoint

-- The PRIMARY category — what the tour fundamentally is. Navigation, SEO titles
-- and the "Tanzania Safaris" landing page key off this one.
--
-- RESTRICT: a category tours are filed under cannot be deleted from under them.
ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "primary_category_id" uuid
	REFERENCES "tour_categories"("id") ON DELETE restrict;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tours_category_idx"
	ON "tours" USING btree ("primary_category_id")
	WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;--> statement-breakpoint

-- A safari-and-Zanzibar itinerary genuinely spans two categories, so filtering
-- needs the set while navigation needs the one. Both live here: the primary is
-- also written into this table, so a category filter is a single join and never
-- has to union a column with a table.
CREATE TABLE IF NOT EXISTS "tour_category_links" (
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
	"category_id" uuid NOT NULL REFERENCES "tour_categories"("id") ON DELETE restrict,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_category_links_pkey" PRIMARY KEY ("tour_id","category_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tour_category_links_category_idx"
	ON "tour_category_links" USING btree ("category_id","sort_order");--> statement-breakpoint

INSERT INTO "tour_categories" ("name","slug","short_description","sort_order") VALUES
	('Safari','safari','Wildlife-focused journeys through Tanzania''s national parks, conservation areas and reserves.',10),
	('Beach & Island','beach-island','Coastal and island holidays including Zanzibar, Mafia, Pemba and the Indian Ocean coast.',20),
	('Mountain & Trekking','mountain-trekking','Climbing, trekking and hiking journeys including Kilimanjaro, Meru and the mountain areas.',30),
	('Culture & Heritage','culture-heritage','Trips centred on Tanzanian culture, communities, history and heritage.',40),
	('Nature & Adventure','nature-adventure','Active outdoor and nature experiences beyond a traditional safari itinerary.',50)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

/* --------------------------------------------------- travel style cleanup -- */

-- Four of the seeded styles were really CATEGORIES, and two were really the
-- departure format. Removing them here is safe precisely because no tour is
-- published yet; the DELETE is guarded on having no tags so it can never destroy
-- a real association if this is somehow run later.
DELETE FROM "travel_styles" ts
WHERE ts."slug" IN ('safari','beach','trekking','cultural','private-tour','group-tour')
  AND NOT EXISTS (SELECT 1 FROM "tour_travel_styles" x WHERE x."travel_style_id" = ts."id");--> statement-breakpoint

-- Renames to the agreed vocabulary. Guarded so a re-run cannot collide.
UPDATE "travel_styles" ts SET "slug" = v."new", "name" = v."name", "updated_at" = now()
FROM (VALUES
	('honeymoon','honeymoon-romance','Honeymoon & Romance'),
	('walking-safari','walking-active','Walking & Active')
) AS v("old","new","name")
WHERE ts."slug" = v."old" AND NOT EXISTS (SELECT 1 FROM "travel_styles" x WHERE x."slug" = v."new");--> statement-breakpoint

UPDATE "travel_styles" SET "name" = 'Cultural Immersion', "slug" = 'cultural-immersion', "updated_at" = now()
WHERE "slug" = 'cultural-immersion' OR ("name" = 'Cultural' AND "slug" NOT IN (SELECT "slug" FROM "travel_styles" WHERE "slug" = 'cultural-immersion'));--> statement-breakpoint

INSERT INTO "travel_styles" ("name","slug","short_description","is_featured","sort_order") VALUES
	('Cultural Immersion','cultural-immersion','Time with communities, not a photo stop.',true,90),
	('Budget','budget','Honest value without pretending the trip is something else.',false,40)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- Featured set and ordering for the styles that remain.
UPDATE "travel_styles" SET "is_featured" = v."feat", "sort_order" = v."ord", "updated_at" = now()
FROM (VALUES
	('luxury',true,10),('honeymoon-romance',true,20),('family',true,30),('budget',false,40),
	('adventure',true,50),('photography',true,60),('birding',true,70),('wildlife',true,80),
	('cultural-immersion',true,90),('walking-active',false,100),('marine-diving',false,110)
) AS v("slug","feat","ord")
WHERE "travel_styles"."slug" = v."slug";
