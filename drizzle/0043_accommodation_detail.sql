-- More of what a lodge actually is.
--
-- The first import carried names and photographs; the second carries the things
-- a traveller reads before choosing where to sleep — what kind of place it is,
-- what it costs in comfort rather than money, and where it stands.
--
-- Every column is nullable. 46 of the 55 properties have a short description and
-- 10 have a recommendation; a schema that demanded them would force somebody to
-- invent forty-five.
alter table accommodations add column if not exists accommodation_level text;
alter table accommodations add column if not exists lodge_type text;
alter table accommodations add column if not exists why_we_recommend text;
alter table accommodations add column if not exists website_url text;
alter table accommodations add column if not exists currency text;
alter table accommodations add column if not exists is_featured boolean not null default false;
alter table accommodations add column if not exists fly_in_available boolean not null default false;
alter table accommodations add column if not exists transfer_available boolean not null default false;
alter table accommodations add column if not exists best_for jsonb not null default '[]'::jsonb;

/* Closed vocabularies, checked. The source export already agrees with both, so
   these constraints document what is true rather than imposing something new —
   and stop the next import inventing a fourth comfort level. */
alter table accommodations drop constraint if exists accommodations_level_chk;
alter table accommodations add constraint accommodations_level_chk
	check (accommodation_level is null or accommodation_level in ('LUXURY', 'MID_RANGE', 'BUDGET'));

alter table accommodations drop constraint if exists accommodations_lodge_type_chk;
alter table accommodations add constraint accommodations_lodge_type_chk
	check (lodge_type is null or lodge_type in (
		'SAFARI_LODGE', 'HOTEL', 'TENTED_CAMP', 'BEACH_RESORT', 'ECO_LODGE', 'BOUTIQUE_HOTEL'
	));

-- Browsing by comfort and by kind is the obvious next filter on a directory of
-- this size, and both are low-cardinality.
create index if not exists accommodations_level_idx on accommodations (accommodation_level);
create index if not exists accommodations_lodge_type_idx on accommodations (lodge_type);
