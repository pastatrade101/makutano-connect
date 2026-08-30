-- A specialist is a seat of its own, not a guide by another name.
--
-- Until now a birding expert or a mountain guide could only be assigned into the
-- guide slot, which meant a trip could never carry BOTH — and the trip sheet
-- said "Guide: Dr Asha Mtei" about somebody who was not guiding it. Splitting
-- the seat is what lets a Kilimanjaro climb name its mountain guide and its
-- driver-guide separately, and it is what makes the specialist's own login show
-- them the trips they are actually on (see the scope in trips.ts).
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "specialist" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "specialist_crew_id" uuid REFERENCES "crew"("id") ON DELETE set null;--> statement-breakpoint

-- The crew scope reads all three link columns on every list a crew member
-- loads. Postgres cannot use one index for an OR across three columns, so each
-- gets its own partial index — partial because the vast majority of trips have
-- nulls here and there is no reason to index those.
CREATE INDEX IF NOT EXISTS "trips_driver_crew_idx" ON "trips" USING btree ("driver_crew_id") WHERE "driver_crew_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_guide_crew_idx" ON "trips" USING btree ("guide_crew_id") WHERE "guide_crew_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trips_specialist_crew_idx" ON "trips" USING btree ("specialist_crew_id") WHERE "specialist_crew_id" IS NOT NULL;
