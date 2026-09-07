-- Professional tour pricing: adult/child rates, group-size tiers, seasons.
--
-- Today a tour carries exactly one money number — price_from — and pricing_type
-- is a LABEL saying what that number means. All 54 published tours are
-- PER_PERSON/USD. There is no child rate anywhere in the product: the operator
-- types one into each quotation, and quotation-lines.ts defaults it to the adult
-- rate when they do not. So a child is charged an adult price unless somebody
-- remembers, every single time.
--
-- price_from is deliberately NOT replaced. It stays exactly what the marketplace
-- reads — ten public surfaces and the JSON-LD Offer depend on it — and becomes a
-- DERIVED value: the lowest adult rate a real party could actually reach. The
-- product rule is that no claim may be made which the software cannot honour, so
-- "From $875" has to correspond to a rate somebody can be quoted.
ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "adult_price" numeric(14,2);
--> statement-breakpoint
-- NULL means NOT CONFIGURED, which is not the same as "same as an adult". The
-- absence is carried to the operator rather than resolved behind their back.
ALTER TABLE "tours" ADD COLUMN IF NOT EXISTS "child_price" numeric(14,2);
--> statement-breakpoint

-- Prices that change with party size, because a vehicle and a guide are shared.
CREATE TABLE IF NOT EXISTS "tour_price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE CASCADE,
	"min_travellers" integer NOT NULL,
	-- NULL is "and above", so an operator can say 7+ without inventing a ceiling.
	"max_travellers" integer,
	"adult_price" numeric(14,2) NOT NULL,
	"child_price" numeric(14,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The invariants the UI also states in words. A band that ends before it
	-- starts, or starts at zero travellers, is not a validation nicety: it is a
	-- band that silently matches nothing or everything.
	CONSTRAINT "tour_price_tiers_range_valid" CHECK ("min_travellers" >= 1 AND ("max_travellers" IS NULL OR "max_travellers" >= "min_travellers")),
	CONSTRAINT "tour_price_tiers_adult_price_positive" CHECK ("adult_price" >= 0),
	CONSTRAINT "tour_price_tiers_child_price_positive" CHECK ("child_price" IS NULL OR "child_price" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_price_tiers_tour_idx" ON "tour_price_tiers" USING btree ("tour_id", "min_travellers");
--> statement-breakpoint
-- Overlap, enforced by the database and not only by the form.
--
-- Two bands covering the same party size give one traveller two prices, and
-- which one wins would then depend on row order. int4range with an exclusion
-- constraint refuses the pair outright. Upper bound is exclusive, hence +1;
-- max_travellers NULL becomes an unbounded range.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "tour_price_tiers" DROP CONSTRAINT IF EXISTS "tour_price_tiers_no_overlap";
--> statement-breakpoint
ALTER TABLE "tour_price_tiers" ADD CONSTRAINT "tour_price_tiers_no_overlap"
	EXCLUDE USING gist (
		"tour_id" WITH =,
		int4range("min_travellers", CASE WHEN "max_travellers" IS NULL THEN NULL ELSE "max_travellers" + 1 END) WITH &&
	);
--> statement-breakpoint

-- Prices that change with the travel date.
CREATE TABLE IF NOT EXISTS "tour_price_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
	"tour_id" uuid NOT NULL REFERENCES "tours"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	-- DATE, not timestamp. A season boundary is a calendar fact — the 1st of July
	-- is the 1st of July in Arusha and in Berlin — and storing an instant moves
	-- the boundary by a day for anyone in another zone.
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"adult_price" numeric(14,2) NOT NULL,
	"child_price" numeric(14,2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_price_seasons_adult_price_positive" CHECK ("adult_price" >= 0),
	CONSTRAINT "tour_price_seasons_child_price_positive" CHECK ("child_price" IS NULL OR "child_price" >= 0),
	CONSTRAINT "tour_price_seasons_name_present" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tour_price_seasons_tour_idx" ON "tour_price_seasons" USING btree ("tour_id", "starts_on");
