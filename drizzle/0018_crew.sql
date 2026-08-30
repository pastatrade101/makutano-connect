-- Drivers, guides and specialists as records rather than typed-in names.
--
-- NOT roles on a user account: a safari driver usually has no company email and
-- no reason to log in, and every membership consumes a plan seat — so requiring
-- an invite to record who is driving would price the feature out of the job it
-- exists for. `user_id` is there for the day one of them needs the app.

DO $$ BEGIN
	CREATE TYPE "crew_type" AS ENUM ('DRIVER', 'GUIDE', 'SPECIALIST');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crew" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
	"type" "crew_type" DEFAULT 'DRIVER' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"licence_number" text,
	"notes" text,
	"user_id" uuid REFERENCES "users"("id") ON DELETE set null,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "crew_tenant_type_idx" ON "crew" USING btree ("tenant_id","type","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_user_idx" ON "crew" USING btree ("user_id");--> statement-breakpoint

-- Trips link to the registry AND keep the name they were assigned. A trip that
-- ran last year must still say who drove it after that person leaves, and every
-- readiness check already reads the text columns — so the registry can be
-- adopted without changing what "ready" means.
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "driver_crew_id" uuid REFERENCES "crew"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "guide_crew_id" uuid REFERENCES "crew"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "accommodation_item_id" uuid REFERENCES "catalog_items"("id") ON DELETE set null;
