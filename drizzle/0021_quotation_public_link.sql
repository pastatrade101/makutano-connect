-- Connect mints its own customer-facing quote link.
--
-- sendQuotation already tries to put a link in the QUOTATION_READY template,
-- but it could only read one out of metadata — which only the legacy site
-- populates. So a quotation Connect ORIGINATED had an empty link variable, and
-- the template engine's empty-variable guard skipped the send entirely: the
-- customer got nothing. Connect could quote, but it could not deliver a quote.
--
-- Nullable and minted on first send, not at creation: a draft nobody has seen
-- has no business having a live URL, and backfilling one for every historic row
-- would hand out links to quotations that were never sent.
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "public_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_public_token_key" ON "quotations" USING btree ("public_token") WHERE "public_token" IS NOT NULL;
