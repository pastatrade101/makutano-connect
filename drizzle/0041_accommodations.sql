-- Where people sleep.
--
-- Until now an itinerary day carried `accommodation` as free text, which is how
-- "Serengeti Serena", "Serena Serengeti" and "serengeti serena lodge" become
-- three different lodges that are the same building — the identical problem the
-- destination directory exists to solve, one level down.
--
-- Platform-owned, like countries and destinations: a lodge is a place, not a
-- tenant's property, and two operators selling the same camp should be pointing
-- at one record. Tenants LINK to accommodations; they do not own them.
create table if not exists accommodations (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	slug text not null,
	-- Where it is, when that is known. Both nullable: the first import carries
	-- names and photographs and nothing else, and a guessed location on a lodge
	-- listing is worse than no location.
	country_id uuid references countries(id) on delete set null,
	destination_id uuid references destinations(id) on delete set null,
	short_description text,
	description text,
	is_active boolean not null default true,
	sort_order integer not null default 0,
	/* Provenance, so an imported record can be traced back and re-imported
	   without duplicating. */
	source text,
	external_ref text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	deleted_at timestamptz
);

create unique index if not exists accommodations_slug_key on accommodations (slug);
create index if not exists accommodations_active_idx on accommodations (is_active, name);
create index if not exists accommodations_destination_idx on accommodations (destination_id);

-- Photographs.
--
-- NOT rows in `media`: these images live in another bucket entirely, and a media
-- row carries an object_key that is the handle for DELETING an object. Pointing
-- Connect's delete path at a key in somebody else's bucket is a way to lose a
-- file that was never ours to remove. These are urls and nothing more.
create table if not exists accommodation_images (
	id uuid primary key default gen_random_uuid(),
	accommodation_id uuid not null references accommodations(id) on delete cascade,
	url text not null,
	/** hero | hero_mobile | card | cover | gallery — the role it played at source. */
	role text,
	alt_text text,
	caption text,
	category text,
	sort_order integer not null default 0,
	created_at timestamptz not null default now()
);

create index if not exists accommodation_images_parent_idx
	on accommodation_images (accommodation_id, sort_order);
-- Re-importing must update, not duplicate.
create unique index if not exists accommodation_images_url_key
	on accommodation_images (accommodation_id, url);

-- Where you stay on this trip, as an ordered list.
--
-- A row is EITHER a directory property or a one-off the operator typed. Both,
-- because the directory will never be complete: a new camp, a private house, a
-- lodge nobody has listed yet. Forcing those into the platform directory would
-- let every tenant write to a shared table to solve a problem local to one
-- listing, and forcing them into free text with no photograph would make the
-- listing worse than the ones around it.
--
-- Its own id rather than a composite key, precisely so a tour can carry several
-- one-off entries, none of which has an accommodation_id to be keyed on.
--
-- RESTRICT on the accommodation: a lodge that tours point at is deactivated,
-- never deleted, exactly as travel styles are.
create table if not exists tour_accommodations (
	id uuid primary key default gen_random_uuid(),
	tour_id uuid not null references tours(id) on delete cascade,
	accommodation_id uuid references accommodations(id) on delete restrict,
	/* Used only when accommodation_id is null. */
	custom_name text,
	custom_images jsonb not null default '[]'::jsonb,
	sort_order integer not null default 0,
	nights integer,
	note text,
	/* One of the two, never neither and never both — the row has to say which
	   kind it is, or rendering it means guessing. */
	constraint tour_accommodations_identity_chk check (
		(accommodation_id is not null and custom_name is null)
		or (accommodation_id is null and custom_name is not null)
	)
);

create index if not exists tour_accommodations_tour_idx on tour_accommodations (tour_id, sort_order);
-- The same lodge twice on one tour is a mistake, not a two-night stay; nights is
-- the field for that. Partial, because one-off rows have no id to collide on.
create unique index if not exists tour_accommodations_unique_property
	on tour_accommodations (tour_id, accommodation_id)
	where accommodation_id is not null;

-- And the night itself.
--
-- The free-text column stays. A day can name somewhere that is not in the
-- directory — a fly camp, a friend's farm — and losing that would be a
-- regression; the id is the upgrade, not the replacement.
alter table tour_itinerary_days
	add column if not exists accommodation_id uuid references accommodations(id) on delete set null;

-- Photographs for a night spent somewhere the directory does not list. Only read
-- when accommodation_id is null: a directory property brings its own pictures,
-- and a second set attached to the day would be two answers to one question.
alter table tour_itinerary_days
	add column if not exists accommodation_images jsonb not null default '[]'::jsonb;

create index if not exists tour_itinerary_days_accommodation_idx
	on tour_itinerary_days (accommodation_id);
