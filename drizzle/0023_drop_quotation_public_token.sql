-- Connect does not serve the customer's quote page; the tenant's own website
-- does.
--
-- 0021 added this an hour earlier on the assumption that Connect should own the
-- sales funnel. It should not: Goldfinch already sends quotation_ready,
-- quotation_accepted, booking_confirmed and inquiry_received from its own site,
-- with its own /quote/<token> page. A second link from Connect would put two
-- quotations in front of the same customer.
--
-- Connect is read-only until a quotation is ACCEPTED; from there it converts,
-- takes payment and runs the trip. Nothing ever read this column.
DROP INDEX IF EXISTS "quotations_public_token_key";--> statement-breakpoint
ALTER TABLE "quotations" DROP COLUMN IF EXISTS "public_token";
