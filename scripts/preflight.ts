// Phase 6 gate — every condition that must hold BEFORE the Meta webhook is repointed.
//
// This changes nothing. It only reports, and it exits non-zero if any REQUIRED check
// fails, so it can gate a deploy step. Run it against the deployed public URL:
//
//   CONNECT_BASE_URL=https://connect.makutano.co.tz \
//   DIRECT_DATABASE_URL=... CREDENTIALS_ENCRYPTION_KEY=... WHATSAPP_VERIFY_TOKEN=... \
//   META_APP_SECRET=... GOLDFINCH_TENANT_SLUG=goldfinch \
//   node --experimental-strip-types scripts/preflight.ts
import crypto from 'node:crypto';
import postgres from 'postgres';

const BASE = (process.env.CONNECT_BASE_URL ?? 'http://localhost:5188').replace(/\/+$/, '');
const SLUG = process.env.GOLDFINCH_TENANT_SLUG ?? 'goldfinch';
const WEBHOOK = `${BASE}/webhooks/meta/whatsapp`;

type Result = { name: string; ok: boolean; required: boolean; detail: string };
const results: Result[] = [];
const record = (name: string, ok: boolean, detail = '', required = true) =>
	results.push({ name, ok, required, detail });

async function main() {
	/* --- public reachability + TLS ---------------------------------------- */
	const isHttps = BASE.startsWith('https://');
	record('Public URL is HTTPS', isHttps, isHttps ? BASE : `${BASE} — Meta will not deliver to plain HTTP`);

	try {
		const res = await fetch(`${BASE}/login`, { redirect: 'manual' });
		record('App reachable', res.status < 500, `GET /login → ${res.status}`);
	} catch (err) {
		record('App reachable', false, (err as Error).message);
	}

	/* --- webhook GET verification ----------------------------------------- */
	const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
	if (verifyToken) {
		const challenge = `preflight${Date.now()}`;
		try {
			const res = await fetch(
				`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=${challenge}`
			);
			const body = await res.text();
			record(
				'Webhook GET verification',
				res.status === 200 && body === challenge,
				`→ ${res.status}, echoed "${body.slice(0, 40)}"`
			);
		} catch (err) {
			record('Webhook GET verification', false, (err as Error).message);
		}
		try {
			const res = await fetch(`${WEBHOOK}?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=x`);
			record('Webhook rejects a wrong verify token', res.status === 403, `→ ${res.status}`);
		} catch (err) {
			record('Webhook rejects a wrong verify token', false, (err as Error).message);
		}
	} else {
		record('Webhook GET verification', false, 'WHATSAPP_VERIFY_TOKEN not provided to this script');
	}

	/* --- webhook POST signature ------------------------------------------- */
	const appSecret = process.env.META_APP_SECRET ?? '';
	if (appSecret) {
		const body = JSON.stringify({
			object: 'whatsapp_business_account',
			entry: [{ id: 'preflight-waba', changes: [{ value: { metadata: { phone_number_id: 'preflight-unowned' } } }] }]
		});
		const sig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body, 'utf8').digest('hex');
		try {
			const good = await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
				body
			});
			record('Webhook accepts a valid HMAC signature', good.status === 200, `→ ${good.status}`);

			const bad = await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
				body: body + ' '
			});
			record('Webhook rejects a tampered body', bad.status === 403, `→ ${bad.status}`);

			const unsigned = await fetch(WEBHOOK, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			});
			record('Webhook rejects an unsigned request', unsigned.status === 403, `→ ${unsigned.status}`);
		} catch (err) {
			record('Webhook signature checks', false, (err as Error).message);
		}
	} else {
		record('Webhook POST signature checks', false, 'META_APP_SECRET not provided to this script');
	}

	/* --- tenant + connection state ---------------------------------------- */
	const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
	if (!dbUrl) {
		record('Database checks', false, 'No DIRECT_DATABASE_URL/DATABASE_URL provided');
	} else {
		const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });
		try {
			const [tenant] =
				await sql`select id, name, status from tenants where slug = ${SLUG} and deleted_at is null limit 1`;
			record(
				`Tenant "${SLUG}" exists`,
				!!tenant,
				tenant ? `${tenant.name} (${tenant.status})` : 'not found — run scripts/import-goldfinch.ts'
			);

			if (tenant) {
				const [conn] = await sql`
					select phone_number_id, waba_id, display_phone_number, status, token_expires_at
					from whatsapp_connections where tenant_id = ${tenant.id} limit 1`;
				record(
					'WhatsApp connection mapped',
					!!conn,
					conn ? `${conn.display_phone_number ?? conn.phone_number_id} · ${conn.status}` : 'no connection row'
				);
				record('phone_number_id mapped', !!conn?.phone_number_id, conn?.phone_number_id ?? '—');
				record('waba_id mapped', !!conn?.waba_id, conn?.waba_id ?? '—');
				record('Connection status is CONNECTED', conn?.status === 'CONNECTED', String(conn?.status ?? '—'));

				if (conn?.token_expires_at) {
					const daysLeft = Math.round((new Date(conn.token_expires_at).getTime() - Date.now()) / 86_400_000);
					record('Token not expiring imminently', daysLeft > 3, `${daysLeft} days left`, false);
				} else {
					record('Token expiry', true, 'no expiry recorded (long-lived token)', false);
				}

				const [keys] =
					await sql`select count(*)::int as n from api_keys where tenant_id = ${tenant.id} and status = 'ACTIVE'`;
				record('Goldfinch has an active API key', keys.n > 0, `${keys.n} active`);
			}

			// No other tenant may claim the same number — the isolation invariant.
			const dupes = await sql`
				select phone_number_id, count(*)::int as n from whatsapp_connections
				group by phone_number_id having count(*) > 1`;
			record(
				'No duplicate phone_number_id across tenants',
				dupes.length === 0,
				dupes.length ? JSON.stringify(dupes) : 'unique'
			);

			const [dead] = await sql`select count(*)::int as n from jobs where status = 'DEAD'`;
			record('No dead background jobs', dead.n === 0, `${dead.n} dead`, false);
		} finally {
			await sql.end({ timeout: 5 });
		}
	}

	/* --- report ------------------------------------------------------------ */
	console.log('\nCutover preflight\n' + '='.repeat(64));
	for (const r of results) {
		const mark = r.ok ? '  PASS' : r.required ? '  FAIL' : '  WARN';
		console.log(`${mark}  ${r.name.padEnd(42)} ${r.detail}`);
	}
	const failed = results.filter((r) => !r.ok && r.required);
	console.log('='.repeat(64));
	if (failed.length === 0) {
		console.log('All required checks passed. Safe to proceed to the Meta webhook cutover.');
	} else {
		console.log(`${failed.length} required check(s) FAILED. Do NOT repoint the Meta webhook yet.`);
		process.exitCode = 1;
	}
}

await main();
