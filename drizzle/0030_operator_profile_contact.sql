-- The operator profile grows a public contact block and a verification actor.
--
-- Purely additive: four nullable columns on a table that is two hours old and
-- holds almost no rows, so there is no rewrite and no lock worth naming.
--
-- WHY these are separate from the tenant's own fields:
--
--   tenants.business_phone and tenants.website_url are OPERATIONAL — they are how
--   Makutano reaches the business, and they end up in invoices and support
--   threads. What an operator wants printed on a public marketplace page is a
--   different decision: often a sales line rather than the owner's mobile, and
--   sometimes nothing at all. Reusing the operational fields would publish a
--   private number the day someone filled it in for billing.
--
--   So these are opt-in by construction: NULL means "do not show it", which is
--   the right default for a page that is crawled and scraped.

ALTER TABLE "operator_profiles"
	-- Records WHO verified, next to the existing verified_at that records when.
	-- SET NULL rather than cascade: an admin leaving the platform must not erase
	-- the fact that the operator was verified, only who signed it off.
	ADD COLUMN IF NOT EXISTS "verified_by" uuid REFERENCES "users"("id") ON DELETE set null,

	-- The operator's own site. Rendered with rel="nofollow noopener" on the public
	-- profile: it is user-submitted, so it must not pass authority or hand the
	-- destination a window handle back to ours.
	ADD COLUMN IF NOT EXISTS "website_url" text,

	-- Deliberately named public_*: whatever goes here WILL be crawled. Kept apart
	-- from the account's own contact details so publishing is always a choice.
	ADD COLUMN IF NOT EXISTS "public_email" text,
	ADD COLUMN IF NOT EXISTS "public_phone" text;--> statement-breakpoint

-- The moderation view answers "who verified this operator, and when" — cheap to
-- serve from an index while the table is small, and it stays cheap.
CREATE INDEX IF NOT EXISTS "operator_profiles_verified_idx"
	ON "operator_profiles" USING btree ("verified_at" DESC) WHERE "is_verified";
