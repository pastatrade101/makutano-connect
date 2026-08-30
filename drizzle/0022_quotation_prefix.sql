-- Stop quotation references reading QT-QT-2026-00001.
--
-- nextReference() builds "<prefix>-<kind>-<year>-<n>" and quotations pass kind
-- 'QT'. The column defaulted to 'QT' as well, so any tenant who never hand-set
-- a prefix got the document type twice and lost their own identity from their
-- own quotation. createQuotation already reads
-- `quotationPrefix || bookingReferencePrefix`, but a NOT NULL default meant the
-- fallback could never fire.
--
-- Nullable with no default, so "unset" is expressible and the fallback works.
-- Existing 'QT' rows are treated as unset and adopt the tenant's booking prefix;
-- goldfinch (GFA) and anyone else who chose a real prefix is untouched.
ALTER TABLE "tenants" ALTER COLUMN "quotation_prefix" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "quotation_prefix" DROP NOT NULL;--> statement-breakpoint

-- References already issued are NOT rewritten: a quotation someone has seen
-- keeps the reference it was sent with. Only what comes next is corrected.
UPDATE "tenants" SET "quotation_prefix" = NULL WHERE "quotation_prefix" = 'QT';
