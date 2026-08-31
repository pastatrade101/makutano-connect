-- The tour marketplace: COUNTRY → DESTINATION → TOUR → ITINERARY → ENQUIRY.
--
-- Two ownership layers, and the split is the point:
--
--   countries + destinations are PLATFORM data. No tenant_id. The Serengeti is the
--   Serengeti for every operator selling it, and /destinations/serengeti has to be
--   ONE page. Tenant-owning these would let six operators create "Serengeti",
--   "Serengeti NP", "Serengeti National Park" and "The Serengeti" and fragment the
--   marketplace into four rival pages chasing one search result.
--
--   tours are TENANT data. The operator writes the listing, owns the enquiry and
--   runs the trip. The tour is also what RESOLVES OWNERSHIP: a public browser names
--   a tour, and the server derives the tenant from it. The browser never says who
--   owns anything.
--
-- Everything here is additive. The only change to an existing table is one nullable
-- column on booking_requests and one new value on the source enum, so no current
-- tenant, query or API changes behaviour.

/* -------------------------------------------------------------------- enums -- */

DO $$ BEGIN
	-- Publishing lifecycle. SUBMITTED and IN_REVIEW are distinct on purpose: the
	-- first is the vendor's act, the second is a platform reviewer picking it up.
	CREATE TYPE "tour_status" AS ENUM (
		'DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED',
		'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	-- A controlled vocabulary, NOT travel style. "Luxury" and "Honeymoon" are not
	-- places and must never appear here.
	CREATE TYPE "destination_type" AS ENUM (
		'NATIONAL_PARK', 'GAME_RESERVE', 'CONSERVATION_AREA', 'MOUNTAIN',
		'ISLAND', 'BEACH', 'CITY', 'CULTURAL_AREA', 'LAKE', 'OTHER'
	);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "content_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Marketplace enquiries are ordinary booking_requests with a known origin. A new
-- source value, NOT a new lead type: the Flutter app and every existing report
-- already understand booking_requests and ignore a source they do not know.
ALTER TYPE "source" ADD VALUE IF NOT EXISTS 'MARKETPLACE';--> statement-breakpoint

/* -------------------------------------------------------------------- media -- */

-- One media table for every marketplace asset, tenant-owned or not.
--
-- tenant_id IS NULL means PLATFORM-owned (a country or destination photograph).
-- A tour or operator asset is always tenant-scoped. Credentials are never stored
-- here and never reach a browser: object_key is the private handle, url is the
-- public delivery address, and uploads are proxied server-side.
CREATE TABLE IF NOT EXISTS "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid REFERENCES "tenants"("id") ON DELETE cascade,
	"storage_provider" text DEFAULT 'R2' NOT NULL,
	-- The R2 object key. Server-generated from the resolved owner — never from a
	-- path the browser supplied, or one tenant could write into another's prefix.
	"object_key" text NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"size" integer,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "media_object_key_idx" ON "media" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tenant_idx" ON "media" USING btree ("tenant_id");--> statement-breakpoint

/* ---------------------------------------------------------------- countries -- */

CREATE TABLE IF NOT EXISTS "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"iso_code" text,
	"short_description" text,
	"description" text,
	"hero_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"is_active" boolean DEFAULT true NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "countries_slug_idx" ON "countries" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "countries_iso_code_idx" ON "countries" USING btree ("iso_code") WHERE "iso_code" IS NOT NULL;--> statement-breakpoint

/* ------------------------------------------------------------- destinations -- */

CREATE TABLE IF NOT EXISTS "destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- RESTRICT: a country with destinations cannot be deleted from under them.
	"country_id" uuid NOT NULL REFERENCES "countries"("id") ON DELETE restrict,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"destination_type" "destination_type" DEFAULT 'OTHER' NOT NULL,
	"short_description" text,
	"description" text,
	"hero_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	-- "How long should I stay?" — one of the five questions a destination page
	-- exists to answer, so it is a field rather than prose to be parsed.
	"recommended_stay_min" integer,
	"recommended_stay_max" integer,
	"best_time_summary" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"travel_tips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "content_status" DEFAULT 'DRAFT' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Slugs are unique GLOBALLY, not per country: the public URL is /destinations/<slug>
-- with no country segment, so two "victoria" rows would fight over one page.
CREATE UNIQUE INDEX IF NOT EXISTS "destinations_slug_idx" ON "destinations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destinations_country_idx" ON "destinations" USING btree ("country_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destinations_type_idx" ON "destinations" USING btree ("destination_type") WHERE "status" = 'PUBLISHED';--> statement-breakpoint

/* ------------------------------------------------------- operator profiles -- */

-- The public face of a tenant. Separate from `tenants` because that row is
-- operational (plan, billing, provisioning) and must not be handed to a browser
-- field by field. This table is the allow-list, by construction.
CREATE TABLE IF NOT EXISTS "operator_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"about" text,
	"logo_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"cover_media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"location" text,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"years_in_business" integer,
	-- Verification is a PLATFORM claim about an operator, so only the platform
	-- writes it. A vendor cannot mark themselves verified.
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "operator_profiles_slug_idx" ON "operator_profiles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operator_profiles_tenant_idx" ON "operator_profiles" USING btree ("tenant_id");--> statement-breakpoint

/* -------------------------------------------------------------------- tours -- */

CREATE TABLE IF NOT EXISTS "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	-- RESTRICT: removing a country must never silently delete the listings selling
	-- it. Multi-country tours are a later addition via tour_destinations, which
	-- already spans countries — this column stays the one used for navigation.
	"primary_country_id" uuid REFERENCES "countries"("id") ON DELETE restrict,

	"title" text NOT NULL,
	-- The public URL is /tours/<slug>: a slug identifies a listing across the WHOLE
	-- marketplace, not within one tenant.
	"slug" text NOT NULL,
	"short_description" text,
	"description" text,

	"duration_days" integer DEFAULT 1 NOT NULL,
	"duration_nights" integer,
	"price_from" numeric(14, 2),
	"currency" text,
	-- PER_PERSON | PER_GROUP | FROM — what price_from actually means.
	"pricing_type" text DEFAULT 'PER_PERSON' NOT NULL,

	-- Experience, never geography. "Safari", "Honeymoon", "Photography".
	"travel_style" text,
	"group_type" text,
	"group_size_min" integer,
	"group_size_max" integer,
	"age_requirement" text,

	"hero_media_id" uuid REFERENCES "media"("id") ON DELETE set null,

	"accommodation_summary" text,
	"transport_summary" text,
	"meals_summary" text,
	"best_time_summary" text,

	-- YEAR_ROUND | SEASONAL | DATE_RANGE
	"availability_type" text DEFAULT 'YEAR_ROUND' NOT NULL,
	"available_from" date,
	"available_to" date,

	"status" "tour_status" DEFAULT 'DRAFT' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,

	"seo_title" text,
	"seo_description" text,

	-- Editorial lists the tour page renders. Read whole, never queried by element,
	-- so jsonb rather than three more tables.
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"included" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded" jsonb DEFAULT '[]'::jsonb NOT NULL,

	-- Moderation trail. A vendor may not approve their own listing, so who reviewed
	-- it is part of the record, not an afterthought.
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid REFERENCES "users"("id") ON DELETE set null,
	"review_note" text,
	"published_at" timestamp with time zone,

	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Soft delete, matching bookings/quotations (0024/0025). An indexed public URL
	-- must not become a hard 404 by accident.
	"deleted_at" timestamp with time zone
);--> statement-breakpoint

-- One LIVE tour per slug. Partial, so retiring a listing releases its slug.
CREATE UNIQUE INDEX IF NOT EXISTS "tours_slug_live_idx"
	ON "tours" USING btree ("slug") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tours_tenant_idx"
	ON "tours" USING btree ("tenant_id","status","updated_at") WHERE "deleted_at" IS NULL;--> statement-breakpoint
-- The only slice the public marketplace ever reads. tenant_id is NOT in it on
-- purpose: a public request must never be able to select a tenant.
CREATE INDEX IF NOT EXISTS "tours_public_idx"
	ON "tours" USING btree ("published_at" DESC)
	WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tours_country_idx"
	ON "tours" USING btree ("primary_country_id")
	WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;--> statement-breakpoint
-- The platform moderation queue, oldest submission first.
CREATE INDEX IF NOT EXISTS "tours_review_idx"
	ON "tours" USING btree ("submitted_at")
	WHERE "status" IN ('SUBMITTED','IN_REVIEW') AND "deleted_at" IS NULL;--> statement-breakpoint

/* -------------------------------------------------------- tour_destinations -- */

-- Many-to-many, relationally. NOT "1,2,3" in a text column and not a jsonb array
-- of names: "every tour visiting Ngorongoro" is the destination page's core query,
-- and renaming a place must not orphan the tours that mention it.
CREATE TABLE IF NOT EXISTS "tour_destinations" (
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
	-- RESTRICT: a destination tours point at cannot be deleted from under them.
	"destination_id" uuid NOT NULL REFERENCES "destinations"("id") ON DELETE restrict,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_destinations_pkey" PRIMARY KEY ("tour_id","destination_id")
);--> statement-breakpoint

-- The composite PK already serves tour → destinations. This serves the other
-- direction, which is the destination page.
CREATE INDEX IF NOT EXISTS "tour_destinations_destination_idx"
	ON "tour_destinations" USING btree ("destination_id","sort_order");--> statement-breakpoint

/* ------------------------------------------------------ tour_itinerary_days -- */

-- Reusable PACKAGE content, deliberately not trip_items: a trip item belongs to one
-- operational departure that actually ran. These two must not be blurred.
CREATE TABLE IF NOT EXISTS "tour_itinerary_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
	"day_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	-- Optional link to a canonical destination, which is what lets the UI DERIVE
	-- the route (Arusha → Tarangire → Serengeti) instead of asking the vendor to
	-- type it a second time.
	"destination_id" uuid REFERENCES "destinations"("id") ON DELETE set null,
	"accommodation" text,
	"meals" text,
	"activities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"distance" text,
	"estimated_travel_time" text,
	"media_id" uuid REFERENCES "media"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tour_itinerary_days_tour_day_idx"
	ON "tour_itinerary_days" USING btree ("tour_id","day_number");--> statement-breakpoint

/* --------------------------------------------------------------- tour_media -- */

-- The gallery. The hero lives on tours.hero_media_id so there is exactly one
-- answer to "which image represents this tour".
CREATE TABLE IF NOT EXISTS "tour_media" (
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE cascade,
	"media_id" uuid NOT NULL REFERENCES "media"("id") ON DELETE cascade,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tour_media_pkey" PRIMARY KEY ("tour_id","media_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tour_media_order_idx" ON "tour_media" USING btree ("tour_id","sort_order");--> statement-breakpoint

/* ------------------------------------------- marketplace enquiry attribution -- */

-- The enquiry a marketplace tour produces is an ORDINARY booking_request. This is
-- the only structural link it needs; UTM/referrer/session live in the existing
-- metadata jsonb, because acquisition context is not lifecycle state.
ALTER TABLE "booking_requests" ADD COLUMN IF NOT EXISTS "tour_id" uuid
	REFERENCES "tours"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "booking_requests_tour_idx"
	ON "booking_requests" USING btree ("tour_id") WHERE "tour_id" IS NOT NULL;
