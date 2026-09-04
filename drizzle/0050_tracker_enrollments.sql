-- The ledger that decides who owns a tracker.
--
-- Ownership used to flow the wrong way: the tracker existed first and a tenant
-- claimed it by typing its identifier, so knowing a reference was the same thing
-- as owning it. Here Connect MINTS the identity for a named vehicle of a named
-- tenant before the provider is touched at all, and the first GPS fix proves
-- LIVENESS rather than ownership — ownership was already decided.
CREATE TABLE IF NOT EXISTS tracker_enrollments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

	-- RESTRICT on both parents. A cascade would empty the authority this design
	-- rests on: deleting the row releases the forever-lock on a reference whose
	-- physical device may still be buffering and still reporting.
	tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
	vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,

	provider text NOT NULL DEFAULT 'TRACCAR',
	device_ref text NOT NULL,
	identifier_source text NOT NULL,
	kind text NOT NULL,
	profile text NOT NULL DEFAULT 'SAFARI',
	label text,

	status text NOT NULL,
	closed_reason text,
	trust text NOT NULL DEFAULT 'VERIFIED',

	provider_device_id integer,
	provider_delete_after timestamptz,
	hardware_sim_msisdn text,

	created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	bound_at timestamptz,
	confirmed_at timestamptz,
	closed_at timestamptz,
	superseded_by_id uuid REFERENCES tracker_enrollments(id) ON DELETE SET NULL,

	first_fix_at timestamptz,
	first_fix_lat numeric(9,6),
	first_fix_lng numeric(9,6),
	poll_attempts integer NOT NULL DEFAULT 0,
	last_polled_at timestamptz,
	metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

	CONSTRAINT te_status_chk CHECK (status IN ('PENDING','ACTIVE','CLOSED','RELEASED')),
	CONSTRAINT te_kind_chk CHECK (kind IN ('PHONE','HARDWARE')),
	CONSTRAINT te_src_chk CHECK (identifier_source IN ('MINTED','ADMIN_ASSERTED','LEGACY')),
	CONSTRAINT te_bound_chk CHECK (status <> 'ACTIVE' OR bound_at IS NOT NULL),
	-- The point of the table: the database refuses to record an active tracker
	-- that never proved liveness, with one named exemption for the migrated row.
	CONSTRAINT te_evid_chk CHECK (status <> 'ACTIVE' OR identifier_source = 'LEGACY' OR first_fix_at IS NOT NULL),
	CONSTRAINT te_rel_chk CHECK (status <> 'RELEASED' OR identifier_source = 'ADMIN_ASSERTED')
);

-- A minted reference is used once and burned. A retired phone's offline buffer
-- flushing into a different vehicle's track is the failure this prevents.
CREATE UNIQUE INDEX IF NOT EXISTS te_ref_forever_key ON tracker_enrollments (provider, device_ref) WHERE status <> 'RELEASED';
CREATE UNIQUE INDEX IF NOT EXISTS te_one_pending_key ON tracker_enrollments (vehicle_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS te_one_active_key ON tracker_enrollments (vehicle_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS te_pending_idx ON tracker_enrollments (status, expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS te_tenant_idx ON tracker_enrollments (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS te_gc_idx ON tracker_enrollments (provider_delete_after) WHERE provider_delete_after IS NOT NULL;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_enrollment_id uuid REFERENCES tracker_enrollments(id) ON DELETE SET NULL;

-- The one live mapping predates the ledger and has no recorded first fix, which
-- is exactly why te_evid_chk exempts LEGACY.
INSERT INTO tracker_enrollments (tenant_id, vehicle_id, provider, device_ref, identifier_source,
	kind, status, trust, bound_at, expires_at, created_at, label)
SELECT v.tenant_id, v.id, coalesce(v.tracker_provider,'TRACCAR'), v.tracker_device_ref,
	'LEGACY','PHONE','ACTIVE','UNVERIFIED', v.tracker_linked_at,
	coalesce(v.tracker_linked_at, now()), coalesce(v.tracker_linked_at, now()),
	'Existing tracker'
FROM vehicles v
WHERE v.tracker_device_ref IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tracker_enrollments e WHERE e.vehicle_id = v.id AND e.status = 'ACTIVE');

UPDATE vehicles v SET tracker_enrollment_id = e.id
FROM tracker_enrollments e WHERE e.vehicle_id = v.id AND e.status = 'ACTIVE' AND v.tracker_enrollment_id IS NULL;
