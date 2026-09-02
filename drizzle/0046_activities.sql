-- What a traveller DOES on a trip, as platform taxonomy.
--
-- A fourth axis beside category (what the trip IS), travel style (HOW it is
-- experienced) and destination (WHERE). Two tours can share all three and still
-- differ on whether anybody gets in a boat.
--
-- The seeded set is derived from inventory, not from a wishlist. The 478
-- activity strings on published itineraries were read first: roughly half are
-- operational — "picnic lunch" alone accounts for 113 of them, and transfers and
-- flights for about 95 more — and those are not things a traveller chooses a
-- safari for. What is seeded below is every concept that both OCCURS in current
-- inventory and would be worth filtering on.
--
-- Nothing is seeded for gorilla trekking, chimpanzee tracking, horseback,
-- fishing or hot-air balloon: there is no tour behind any of them today, and a
-- taxonomy row with no inventory is a filter that can only ever return nothing.
-- They cost one INSERT to add the day an operator lists one.
CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"icon" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tour_activities" (
	"tour_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_activities_pkey" PRIMARY KEY("tour_id","activity_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tour_activities" ADD CONSTRAINT "tour_activities_tour_id_tours_id_fk"
		FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
-- RESTRICT, as with travel styles: an activity tours are tagged with is
-- deactivated, never deleted out from under them.
DO $$ BEGIN
	ALTER TABLE "tour_activities" ADD CONSTRAINT "tour_activities_activity_id_activities_id_fk"
		FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_slug_idx" ON "activities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_active_idx" ON "activities" USING btree ("sort_order","name") WHERE "activities"."is_active";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_activities_activity_idx" ON "tour_activities" USING btree ("activity_id","sort_order");--> statement-breakpoint

-- Seeded on slug, so re-running changes nothing.
INSERT INTO "activities" ("name","slug","short_description","sort_order") VALUES
	('Game drive','game-drive','Out in a vehicle looking for wildlife — the spine of most safaris.',10),
	('Walking safari','walking-safari','On foot with an armed guide, at the pace of the ground.',20),
	('Boat safari','boat-safari','Wildlife watched from the water rather than the track.',30),
	('Beach time','beach-time','Days with nothing scheduled, on the coast or the islands.',40),
	('Cultural visit','cultural-visit','Time in a village, a spice farm or a stone-built town.',50),
	('Waterfall walk','waterfall-walk','A walk out to falls, usually with coffee or a village on the way.',60)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- The one travel style the discovery work asked for that did not already exist.
-- Fly-in is HOW a safari is structured, not where it goes, so it belongs here
-- rather than as a category or a destination.
INSERT INTO "travel_styles" ("name","slug","short_description","is_featured","sort_order") VALUES
	('Fly-in Safari','fly-in-safari','Light aircraft between camps instead of long hours on the road.',false,115)
ON CONFLICT ("slug") DO NOTHING;
