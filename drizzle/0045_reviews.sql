-- Traveller reviews, backed by a real booking.
--
-- The whole point of this table is that a row cannot exist without a booking
-- behind it. That is what makes a rating on this marketplace mean something,
-- and it is enforced structurally rather than by a "verified" flag somebody
-- could switch on: booking_id is NOT NULL and UNIQUE, and the service that
-- writes here resolves the customer, the tenant and the tour FROM that booking
-- rather than from anything a browser sent.
--
-- Three parties, three different rights, and the schema draws the line:
--   the traveller owns rating/title/body
--   the operator owns operator_response and nothing else
--   the platform owns status and the moderation columns
create type review_status as enum ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED');

create table if not exists reviews (
	id uuid primary key default gen_random_uuid(),

	/* The source of truth. Everything below is derived from it server-side. */
	booking_id uuid not null references bookings(id) on delete cascade,
	tenant_id uuid not null references tenants(id) on delete cascade,
	customer_id uuid not null references customers(id) on delete cascade,
	/* Nullable: an accepted quotation for a custom trip has no marketplace tour,
	   and refusing the review would punish the traveller for how they booked. It
	   still counts towards the operator's rating. */
	tour_id uuid references tours(id) on delete set null,

	rating integer not null,
	title text,
	body text not null,

	status review_status not null default 'PENDING',

	/*
	 * The traveller's way in — stored as a HASH, never in the clear.
	 *
	 * There is no customer login anywhere in this product, so an unguessable
	 * token is how a traveller reaches their own review. The quotation flow
	 * proved the shape but stores its token raw; a review invitation lives for
	 * months in an inbox, so anyone with read access to this table would
	 * otherwise be able to write reviews as any traveller. Only the sha256 is
	 * kept: the raw token exists in the email and nowhere else.
	 */
	invite_token_hash text,
	invited_at timestamptz,
	/*
	 * A link that works forever is a link that leaks forever. Expiry blocks
	 * writing, never reading: a traveller returning after it lapses still sees
	 * what they wrote.
	 */
	expires_at timestamptz,

	submitted_at timestamptz not null default now(),
	published_at timestamptz,
	edited_at timestamptz,

	moderated_at timestamptz,
	moderated_by uuid references users(id) on delete set null,
	moderation_reason text,

	/* The operator's only writable field. */
	operator_response text,
	operator_responded_at timestamptz,

	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),

	constraint reviews_rating_chk check (rating between 1 and 5),
	/* One review per booking, at the database and not merely in the UI. */
	constraint reviews_booking_key unique (booking_id)
);

create unique index if not exists reviews_invite_token_key
	on reviews (invite_token_hash)
	where invite_token_hash is not null;

/*
 * The three reads this table exists for, indexed for each.
 *
 * Public tour page and public operator page both filter on status and order by
 * publication; the partial indexes keep those off the pending/hidden rows
 * entirely rather than filtering them out after the fact.
 */
create index if not exists reviews_tour_published_idx
	on reviews (tour_id, published_at desc)
	where status = 'PUBLISHED';

create index if not exists reviews_tenant_published_idx
	on reviews (tenant_id, published_at desc)
	where status = 'PUBLISHED';

/* The operator's own list and the platform's moderation queue. */
create index if not exists reviews_tenant_status_idx on reviews (tenant_id, status, submitted_at desc);
create index if not exists reviews_status_idx on reviews (status, submitted_at desc);
create index if not exists reviews_customer_idx on reviews (customer_id);
