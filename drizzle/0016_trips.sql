-- Trips: the operational half of a sale, kept apart from the commercial booking.
--
-- A booking answers "what did they buy and have they paid". A trip answers "can
-- this actually depart". Separate tables because they are separate jobs, done by
-- separate people, at separate times.

DO $$ BEGIN
	CREATE TYPE "trip_status" AS ENUM ('PREPARING', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"trip_reference" text NOT NULL,
	"booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE cascade,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE set null,
	"status" "trip_status" DEFAULT 'PREPARING' NOT NULL,
	"title" text NOT NULL,
	"operations_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"vehicle" text,
	"driver" text,
	"guide" text,
	"accommodation" text,
	"hotel_confirmed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ready_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "trips_tenant_reference_key" ON "trips" USING btree ("tenant_id","trip_reference");--> statement-breakpoint
-- One trip per booking. Two trips for one sale is always a mistake, and a
-- constraint is cheaper than the code that would have to detect it.
CREATE UNIQUE INDEX IF NOT EXISTS "trips_booking_key" ON "trips" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_tenant_status_idx" ON "trips" USING btree ("tenant_id","status","start_date");--> statement-breakpoint
-- The operations home screen's only query: my trips, soonest first.
CREATE INDEX IF NOT EXISTS "trips_operations_idx" ON "trips" USING btree ("tenant_id","operations_user_id","start_date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trip_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE cascade,
	"type" "booking_item_type" DEFAULT 'TOUR' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"day_number" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"confirmed" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trip_items_trip_idx" ON "trip_items" USING btree ("trip_id","day_number","sort_order");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trip_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"trip_id" uuid NOT NULL REFERENCES "trips"("id") ON DELETE cascade,
	"from_status" "trip_status",
	"to_status" "trip_status" NOT NULL,
	"reason" text,
	"changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"changed_by_api_key_id" uuid REFERENCES "api_keys"("id") ON DELETE set null,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trip_status_history_trip_idx" ON "trip_status_history" USING btree ("trip_id","created_at");
--> statement-breakpoint

-- Operations: the narrowest role in the product. Prepares trips, sees traveller
-- passports, and reads everything commercial without being able to move money.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'OPERATIONS';
