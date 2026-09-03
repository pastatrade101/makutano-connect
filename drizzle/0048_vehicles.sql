-- The fleet registry, and the tracker mapped to it.
--
-- ADDITIVE ONLY. `trips.vehicle` is NOT removed, renamed or altered.
--
-- That column is not decoration: the readiness CHECKS entry reads
-- `Boolean(trip.vehicle?.trim())` with critical: true, and the blocked-trip
-- aggregate reads `nullif(btrim(coalesce(trips.vehicle,'')),'') is null` in raw
-- SQL. A structured assignment that wrote only vehicle_id would mark every trip
-- in the tenant as unable to depart — on the web portal, in the mobile work feed
-- and in the red header count, at once. The text stays authoritative; the id is
-- the registry link beside it, exactly as driver/driver_crew_id already pairs.
--
-- A shipped Flutter client also reads trips.vehicle as a plain String, so the
-- column must keep holding a human-readable string forever.

CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"registration" text,
	"make" text,
	"model" text,
	-- Free-form: 4X4, MINIBUS, SEDAN, BOAT. Not a lifecycle, so not an enum.
	"type" text,
	"seats" integer,
	"notes" text,
	"external_reference" text,
	"external_source" text,
	-- Deactivated, never deleted: a trip that ran last year still names the
	-- vehicle that ran it, and deleting the row would rewrite that history.
	"is_active" boolean DEFAULT true NOT NULL,

	-- Tracking. Named by PROVIDER so the columns outlive the provider.
	"tracker_provider" text,
	-- Deliberately not "device_id": device_tokens already owns that word here and
	-- means a Firebase push handle.
	"tracker_device_ref" text,
	"tracker_linked_at" timestamp with time zone,

	-- The newest fix only — one row, not a time series. The provider stays the
	-- source of truth for history; this exists so a list can say "last seen 2h
	-- ago" without one outbound call per row.
	"last_fix_at" timestamp with time zone,
	"last_fix_lat" numeric(9, 6),
	"last_fix_lng" numeric(9, 6),
	"last_sync_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk"
		FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vehicles_tenant_active_idx" ON "vehicles" ("tenant_id", "is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_source_idx" ON "vehicles" ("tenant_id", "external_source", "external_reference");--> statement-breakpoint

-- GLOBALLY unique, deliberately NOT scoped to a tenant.
--
-- On a shared tracking server the device reference is what identifies whose
-- position stream this is. Scoped per tenant, tenant B could map tenant A's
-- device and quietly receive its positions. The cost is accepted and real: two
-- tenants cannot share one physical tracker.
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_tracker_ref_key"
	ON "vehicles" ("tracker_provider", "tracker_device_ref")
	WHERE "tracker_device_ref" IS NOT NULL;
--> statement-breakpoint

-- The registry link on a trip. Nullable, additive, ON DELETE SET NULL: removing
-- a vehicle from the registry must not delete the trip that used it, and the
-- snapshot text survives so the trip still says what ran it.
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "vehicle_id" uuid;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk"
		FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Partial: most trips will never carry a registry id, so the index only covers
-- the ones that do.
CREATE INDEX IF NOT EXISTS "trips_vehicle_idx" ON "trips" ("vehicle_id") WHERE "vehicle_id" IS NOT NULL;
