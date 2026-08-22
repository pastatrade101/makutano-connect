// Phase 2 — import a legacy integration's WhatsApp connection into Makutano Connect.
//
// Both existing integrations (Goldfinch, makutano-digital) hold their WhatsApp
// credentials as PLAINTEXT env values in their own deployments — neither has rows in
// its per-tenant connection table. So the import reads an access token handed in via
// the environment, PROVES it against Meta (a dead or mis-scoped token is refused, not
// imported), seals it with Connect's AES-256-GCM key, and writes the tenant +
// connection + scoped API key. The plaintext token exists only in memory here and is
// never printed or logged.
//
// IDEMPOTENT and NON-DESTRUCTIVE: re-running updates the same rows; a number owned by
// a DIFFERENT tenant is refused; nothing in any legacy system is modified.
//
// Usage:
//   IMPORT_TENANT_NAME="Goldfinch Adventures" IMPORT_TENANT_SLUG=goldfinch \
//   IMPORT_PREFIX=GFA IMPORT_PLAN=BUSINESS \
//   IMPORT_PHONE_NUMBER_ID=… IMPORT_WABA_ID=… IMPORT_ACCESS_TOKEN=… \
//   [IMPORT_LEGACY_WEBHOOK_URL=https://…]   # relay target, only if the legacy app is live
//   [IMPORT_OWNER_EMAIL=…]
//   node --experimental-strip-types scripts/import-legacy-tenant.ts [--dry-run]
//
// Plus Connect's own DIRECT_DATABASE_URL / CREDENTIALS_ENCRYPTION_KEY / META_APP_ID /
// META_APP_SECRET (for the token-expiry probe).
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import postgres from 'postgres';

const DRY_RUN = process.argv.includes('--dry-run');

function required(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`Missing required environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

const connectUrl = process.env.DIRECT_DATABASE_URL || required('DATABASE_URL');
const connectKey = required('CREDENTIALS_ENCRYPTION_KEY');
const graphVersion = process.env.META_GRAPH_VERSION || 'v21.0';

const tenantName = required('IMPORT_TENANT_NAME');
const tenantSlug = required('IMPORT_TENANT_SLUG');
const prefix = (process.env.IMPORT_PREFIX ?? tenantSlug.slice(0, 3))
	.toUpperCase()
	.replace(/[^A-Z0-9]/g, '')
	.slice(0, 8);
const planCode = process.env.IMPORT_PLAN ?? 'BUSINESS';
const phoneNumberId = required('IMPORT_PHONE_NUMBER_ID');
const wabaId = required('IMPORT_WABA_ID');
const accessToken = required('IMPORT_ACCESS_TOKEN');
const legacyWebhookUrl = process.env.IMPORT_LEGACY_WEBHOOK_URL || null;
const ownerEmail = process.env.IMPORT_OWNER_EMAIL?.trim().toLowerCase() || null;

function seal(plaintext: string): string {
	const key = crypto.createHash('sha256').update(connectKey, 'utf8').digest();
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}

async function hashPassword(password: string): Promise<string> {
	const scrypt = promisify(crypto.scrypt) as never as (
		p: string,
		s: Buffer,
		k: number,
		o: crypto.ScryptOptions
	) => Promise<Buffer>;
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
	return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

console.log(DRY_RUN ? '— DRY RUN: nothing will be written —\n' : '— LIVE IMPORT —\n');
console.log(`Importing "${tenantName}" (slug ${tenantSlug}, prefix ${prefix}, plan ${planCode})`);
console.log(`  phone_number_id ${phoneNumberId}`);
console.log(`  waba_id         ${wabaId}`);
console.log(`  token           present (${accessToken.length} chars, never printed)`);
console.log(`  legacy relay    ${legacyWebhookUrl ?? 'none'}`);

// 1. AUTHORITATIVE Meta checks: the token must be able to read this exact number.
const numberRes = await fetch(
	`https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
	{ headers: { Authorization: `Bearer ${accessToken}` } }
);
if (!numberRes.ok) {
	console.error(`\nMeta refused to read ${phoneNumberId} with this token (HTTP ${numberRes.status}).`);
	console.error((await numberRes.text()).slice(0, 300));
	console.error('Refusing to import a credential Meta will not accept.');
	process.exit(1);
}
const number = (await numberRes.json()) as {
	display_phone_number?: string;
	verified_name?: string;
	quality_rating?: string;
};
console.log(
	`  Meta check      OK — ${number.display_phone_number} (${number.verified_name}), quality ${number.quality_rating ?? 'n/a'}`
);

// 2. Token expiry via debug_token (best effort — system-user tokens report 0 = never).
let tokenExpiresAt: string | null = null;
const appId = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
if (appId && appSecret) {
	try {
		const dbg = await fetch(
			`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
		);
		const info = ((await dbg.json()) as { data?: { expires_at?: number; type?: string } }).data;
		if (info?.expires_at && info.expires_at > 0) tokenExpiresAt = new Date(info.expires_at * 1000).toISOString();
		console.log(`  token type      ${info?.type ?? '?'}, expires ${tokenExpiresAt ?? 'never (long-lived)'}`);
	} catch {
		console.log('  token expiry    could not be determined (continuing)');
	}
}

if (DRY_RUN) {
	console.log(`\nWOULD CREATE/UPDATE tenant "${tenantName}" (plan ${planCode})`);
	console.log(`WOULD MAP ${phoneNumberId} → whatsapp_connections → tenant "${tenantSlug}"`);
	console.log("WOULD ENCRYPT the access token with Connect's AES-256-GCM key (v1 envelope)");
	console.log('WOULD CREATE a scoped mk_live_ API key for the legacy backend');
	if (legacyWebhookUrl) console.log(`WOULD SET tenant.settings.legacy_webhook_url = ${legacyWebhookUrl}`);
	if (ownerEmail) console.log(`WOULD ENSURE an OWNER login for ${ownerEmail}`);
	console.log('WOULD NOT modify any legacy system.');
	process.exit(0);
}

const sql = postgres(connectUrl, { max: 1, prepare: false, onnotice: () => {} });
try {
	const settings = legacyWebhookUrl ? { legacy_webhook_url: legacyWebhookUrl } : {};
	const [tenant] = await sql`
		insert into tenants (slug, name, booking_reference_prefix, quotation_prefix, country, currency, timezone, plan_id, status, settings)
		values (${tenantSlug}, ${tenantName}, ${prefix}, 'QT', 'TZ', 'USD', 'Africa/Dar_es_Salaam',
		        (select id from plans where code = ${planCode} limit 1), 'ACTIVE', ${sql.json(settings)})
		on conflict (slug) do update
			set name = excluded.name,
			    settings = tenants.settings || excluded.settings,
			    updated_at = now()
		returning id, slug, name`;
	console.log(`\nTenant ready: ${tenant.name} (${tenant.id})`);

	const [owner] =
		await sql`select tenant_id from whatsapp_connections where phone_number_id = ${phoneNumberId} limit 1`;
	if (owner && owner.tenant_id !== tenant.id) {
		console.error(`Refusing: ${phoneNumberId} is already owned by tenant ${owner.tenant_id}.`);
		process.exit(1);
	}

	const [connection] = await sql`
		insert into whatsapp_connections (
			tenant_id, waba_id, phone_number_id, display_phone_number, business_name,
			encrypted_access_token, key_version, token_expires_at, status, is_primary, connected_at)
		values (${tenant.id}, ${wabaId}, ${phoneNumberId}, ${number.display_phone_number}, ${number.verified_name},
		        ${seal(accessToken)}, 1, ${tokenExpiresAt}, 'CONNECTED', true, now())
		on conflict (phone_number_id) do update set
			tenant_id = excluded.tenant_id,
			waba_id = excluded.waba_id,
			display_phone_number = excluded.display_phone_number,
			business_name = excluded.business_name,
			encrypted_access_token = excluded.encrypted_access_token,
			key_version = excluded.key_version,
			token_expires_at = excluded.token_expires_at,
			status = 'CONNECTED',
			disconnected_at = null,
			updated_at = now()
		returning id, phone_number_id, status`;
	console.log(`Connection ready: ${connection.phone_number_id} → ${connection.status} (${connection.id})`);

	// One API key per import run would pile up on re-runs; reuse a live one if present.
	const [existingKey] = await sql`
		select id from api_keys where tenant_id = ${tenant.id} and status = 'ACTIVE' and name = 'Legacy backend' limit 1`;
	if (existingKey) {
		console.log('API key: an active "Legacy backend" key already exists — not issuing another.');
	} else {
		const secret = `mk_live_${crypto.randomBytes(24).toString('base64url')}`;
		const scopes = [
			'booking_requests:read',
			'booking_requests:write',
			'bookings:read',
			'bookings:write',
			'customers:read',
			'customers:write',
			'leads:read',
			'leads:write',
			'conversations:read',
			'whatsapp:read',
			'whatsapp:send',
			'quotations:read',
			'quotations:write',
			'payments:read'
		];
		await sql`
			insert into api_keys (tenant_id, name, key_hash, prefix, environment, scopes, status)
			values (${tenant.id}, 'Legacy backend', ${crypto.createHash('sha256').update(secret, 'utf8').digest('hex')},
			        ${secret.slice(0, 16)}, 'live', ${sql.json(scopes)}, 'ACTIVE')`;
		console.log("\n=== API key for this tenant's backend — shown once ===");
		console.log(`MAKUTANO_API_KEY=${secret}`);
	}

	if (ownerEmail) {
		const [existing] = await sql`select id from users where lower(email) = ${ownerEmail} limit 1`;
		let userId = existing?.id as string | undefined;
		let tempPassword: string | null = null;
		if (!userId) {
			tempPassword = `mk-${crypto.randomBytes(9).toString('base64url')}`;
			const [created] = await sql`
				insert into users (email, password_hash, full_name) values (${ownerEmail}, ${await hashPassword(tempPassword)}, '')
				returning id`;
			userId = created.id as string;
		}
		await sql`
			insert into tenant_memberships (tenant_id, user_id, role, accepted_at)
			values (${tenant.id}, ${userId}, 'OWNER', now())
			on conflict (tenant_id, user_id) do update set role = 'OWNER'`;
		console.log(
			`Owner login: ${ownerEmail}${tempPassword ? ` (temporary password: ${tempPassword})` : ' (existing user)'}`
		);
	}

	await sql`
		insert into audit_logs (tenant_id, action, actor_type, entity_type, entity_id, metadata)
		values (${tenant.id}, 'whatsapp.connected', 'system', 'whatsapp_connection', ${connection.id},
		        ${sql.json({ imported_from: 'legacy_env', phone_number_id: phoneNumberId, waba_id: wabaId })})`;

	console.log('\nImport complete. No legacy system was modified.');
} finally {
	await sql.end({ timeout: 5 });
}
