-- Remove the catalog ("Services & Packages").
--
-- It was a per-tenant list of products or packages for quick-picking into an
-- order. Across six tenants it had produced zero orders, zero order links and
-- zero forms that referenced it. Its only content — 55 rows on one tenant,
-- pulled in by website sync — was a list of LODGES, which now lives in the
-- platform `accommodations` directory with photographs, comfort levels and a
-- destination each. The catalog was standing in for a table that now exists.
--
-- The UI also over-promised: it said the list made "manual bookings and
-- quotations" faster, and neither composer ever read it.
--
-- Data is dropped rather than parked. The only rows are the lodge list, which
-- has been re-imported properly; keeping a second copy of it under a name
-- nothing reads is how a schema accumulates ghosts.

-- References first, so the drop below cannot fail on a dependency.
alter table order_items drop column if exists catalog_item_id;
alter table order_links drop column if exists catalog_item_id;
alter table forms drop column if exists catalog_item_ids;

/*
 * trips.accommodation_item_id now points at `accommodations`, not at a catalog
 * row.
 *
 * It DID have a foreign key to catalog_items — added by an earlier migration and
 * never declared in the Drizzle schema, which called the column a bare uuid. The
 * first attempt at this migration failed on exactly that, which is the useful
 * kind of failure: the database was right and the schema file was out of date.
 *
 * The old ids mean nothing against the new table, so they are cleared. The
 * `accommodation` TEXT column beside them keeps the NAME, so no trip forgets
 * where it was sleeping — only the link needs re-picking.
 */
alter table trips drop constraint if exists trips_accommodation_item_id_fkey;
update trips set accommodation_item_id = null where accommodation_item_id is not null;
alter table trips
	add constraint trips_accommodation_item_id_fkey
	foreign key (accommodation_item_id) references accommodations(id) on delete set null;

drop table if exists catalog_items;
drop type if exists catalog_item_type;
