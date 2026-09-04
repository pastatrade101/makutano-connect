-- Per-tenant tracking-provider identities.
--
-- Connect has held ONE shared administrator credential for the whole platform.
-- Every runtime read went through it, so the provider's own permission system
-- was doing nothing: isolation existed only because Connect remembered to
-- filter. This table gives each tenant its own read-only provider identity, so
-- a cross-tenant position becomes unreachable at the provider rather than
-- merely unrendered.
--
-- The credential is stored in the same AES-256-GCM envelope as WhatsApp tokens
-- (v<keyVersion>.<iv>.<tag>.<ciphertext> under CREDENTIALS_ENCRYPTION_KEY), so
-- there is one encryption story in this codebase rather than two.
CREATE TABLE IF NOT EXISTS tracking_accounts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

	-- RESTRICT, not CASCADE: deleting a tenant whose provider identity still
	-- exists would strand a user and its devices on the provider with nothing in
	-- Connect naming them. Offboarding disables the provider user first.
	tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,

	provider text NOT NULL DEFAULT 'TRACCAR',

	-- The login Connect created on the provider. A non-routable domain by
	-- RFC 2606, because this address must never receive mail.
	provider_login text NOT NULL,

	-- The provider's numeric user id, cached so provisioning never has to search
	-- by login.
	provider_user_id integer,

	encrypted_password text NOT NULL,
	key_version integer NOT NULL DEFAULT 1,

	-- Set when the identity has been verified to be read-only and correctly
	-- scoped. Null means provisioned but not yet proven.
	verified_at timestamptz,

	disabled_at timestamptz,
	last_used_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

-- One identity per tenant per provider.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_accounts_tenant_provider_key
	ON tracking_accounts (tenant_id, provider);

-- And one Connect tenant per provider user, so two tenants can never end up
-- sharing an identity through a provisioning retry.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_accounts_provider_user_key
	ON tracking_accounts (provider, provider_user_id)
	WHERE provider_user_id IS NOT NULL;
