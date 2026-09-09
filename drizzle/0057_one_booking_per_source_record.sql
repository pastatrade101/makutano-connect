-- One Connect booking per record in a source system.
--
-- The Goldfinch handover promotes a mirrored enquiry to a booking and is idempotent
-- on the SOURCE's reference — a replayed webhook, a retry after a timeout and a second
-- confirm all have to land on the same booking. That idempotency was a SELECT followed
-- by an INSERT with nothing between them and no index underneath: the same read-then-act
-- shape that produced five bookings from five concurrent accepts.
--
-- The identity being expressed is the integration's own: a reference is only unique
-- WITHIN the system that issued it, so the key is (tenant, source, reference) rather
-- than the reference alone. Two different source systems may legitimately use the same
-- code, and two tenants certainly may.
--
-- Partial, for the same reasons as 0056: bookings raised in Connect carry no external
-- reference and must not be constrained, and a soft-deleted booking must not block
-- re-creating one.
--
-- Audited immediately before writing this: no duplicates, no rows carrying a reference
-- without a source, and in fact zero bookings carry an external_reference at all —
-- this path has never produced one in production.
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_one_per_source_record"
  ON "bookings" ("tenant_id", "external_source", "external_reference")
  WHERE "external_reference" IS NOT NULL AND "deleted_at" IS NULL;
