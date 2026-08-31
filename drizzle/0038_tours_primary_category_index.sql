-- An index behind tours.primary_category_id.
--
-- Not for reading — for WRITING. tour_categories is referenced with ON DELETE
-- RESTRICT, and without an index Postgres enforces that by sequentially scanning
-- `tours` and locking as it goes. Any attempt to retire or remove a category then
-- queues behind every concurrent insert into the busiest table in the schema. The
-- test suite found it: a delete that takes 500ms in isolation had not returned
-- after two minutes under parallel load.
--
-- Partial, because a listing with no category is not a candidate for the check.
--
-- This is its own migration rather than a line in 0036, where it started life.
-- 0036 had already been applied in production when the index was written, so
-- appending it there meant it silently never ran — the database was checked and
-- the index simply was not there. An applied migration is a record of what
-- happened, not a file to edit.

CREATE INDEX IF NOT EXISTS "tours_primary_category_idx"
	ON "tours" ("primary_category_id") WHERE "primary_category_id" IS NOT NULL;
