-- Discovery Ranking V1: one configuration row, and the exposure it ranks on.
--
-- TWO TABLES, AND ONE OF THEM IS THE POINT.
--
-- `discovery_config` is settings. `tour_impressions` is the prerequisite: the
-- fairness component ranks on how much exposure an operator has had RECENTLY,
-- and nothing in this product has ever recorded that. Until this table exists
-- and has been collecting for a window, fairness has no data and every operator
-- scores identically — so it ships first and starts filling, whatever else waits.
--
-- Deliberately NOT here: any per-operator or per-tour boost column. A neutral
-- organic ranking is only neutral if the schema gives nobody a thumb to press.

CREATE TABLE IF NOT EXISTS "discovery_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- Bumped whenever the settings change, and stamped onto every impression, so
	-- "did enquiries move because we changed the ranking?" is answerable later
	-- rather than a matter of opinion.
	"version" integer NOT NULL DEFAULT 1,

	-- Must total 100. Enforced in the service AND here, because a config written
	-- by hand in psql would otherwise silently rescale every score in the system.
	"relevance_weight" integer NOT NULL DEFAULT 40,
	"quality_weight" integer NOT NULL DEFAULT 20,
	"fairness_weight" integer NOT NULL DEFAULT 20,
	"freshness_weight" integer NOT NULL DEFAULT 10,
	"performance_weight" integer NOT NULL DEFAULT 10,

	"exposure_window_days" integer NOT NULL DEFAULT 30,
	"exploration_boost" integer NOT NULL DEFAULT 10,
	"new_operator_boost_enabled" boolean NOT NULL DEFAULT true,

	"first_window_size" integer NOT NULL DEFAULT 6,
	"first_window_max_per_operator" integer NOT NULL DEFAULT 1,
	"second_window_size" integer NOT NULL DEFAULT 12,
	"second_window_max_per_operator" integer NOT NULL DEFAULT 2,

	"is_active" boolean NOT NULL DEFAULT true,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "discovery_config_weights_total" CHECK (
		"relevance_weight" + "quality_weight" + "fairness_weight"
		+ "freshness_weight" + "performance_weight" = 100
	),
	CONSTRAINT "discovery_config_windows" CHECK ("second_window_size" >= "first_window_size")
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "discovery_config" ADD CONSTRAINT "discovery_config_updated_by_users_id_fk"
		FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- V1 has exactly one active configuration. A partial unique index says so in the
-- database rather than hoping the service always remembers.
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_config_single_active_idx"
	ON "discovery_config" ("is_active") WHERE "is_active";
--> statement-breakpoint

-- What was shown, where, and in which position.
--
-- No traveller identity, no IP, no user agent: fairness needs to know that a
-- tour was seen, not who saw it. `session_key` is an opaque rotation key the
-- ranking already computes and is never joined to a person.
CREATE TABLE IF NOT EXISTS "tour_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	-- The tenant that owns the tour, denormalised on purpose: every fairness
	-- query groups by operator, and joining tours for it on every read would make
	-- the aggregate materially more expensive for a value that cannot change.
	"tenant_id" uuid NOT NULL,
	-- HOME, TOURS, COUNTRY, DESTINATION, CATEGORY, TRAVEL_STYLE, SEARCH.
	"context" text NOT NULL,
	"country_id" uuid,
	"destination_id" uuid,
	"position" integer NOT NULL,
	-- Which configuration produced this ordering.
	"ranking_version" integer NOT NULL DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "tour_impressions" ADD CONSTRAINT "tour_impressions_tour_id_tours_id_fk"
		FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tour_impressions" ADD CONSTRAINT "tour_impressions_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- The two reads that matter, and nothing speculative.
-- Fairness aggregates by tenant within the window; the per-tour index serves the
-- same aggregate keyed the other way and the admin preview.
CREATE INDEX IF NOT EXISTS "tour_impressions_window_idx"
	ON "tour_impressions" ("created_at" DESC, "tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_impressions_tour_idx"
	ON "tour_impressions" ("tour_id", "created_at" DESC);--> statement-breakpoint

-- The single V1 configuration, at the documented defaults.
INSERT INTO "discovery_config" ("version") VALUES (1) ON CONFLICT DO NOTHING;
