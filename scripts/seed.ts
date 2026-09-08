// Seed the four plans (§27) and, when SEED_SUPER_ADMIN_EMAIL is set, a super admin.
// Idempotent: safe to re-run.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';

const scrypt = promisify(crypto.scrypt) as (
	p: string,
	s: Buffer,
	k: number,
	o: crypto.ScryptOptions
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
	return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/*
 * `limits` and `features` are the ORIGINAL vocabulary and nothing resolves against
 * them any more — effectiveEntitlements() reads `plans.entitlements`, keyed by the
 * dotted ENTITLEMENT_KEYS. This seed wrote only the first two for months, so a
 * freshly seeded database gave every plan an EMPTY entitlement map: every key fell
 * through to `definition.fallback` and three entitlement tests failed on values
 * nobody had changed. The old columns stay because existing rows carry them; the
 * entitlements below are production's, so a local database resolves the way the
 * live one does.
 */
const PLANS = [
	{
		code: 'STARTER',
		name: 'Starter',
		priceMonthly: '29',
		sortOrder: 1,
		entitlements: {
			'api.enabled': true,
			'api.maxKeys': 2,
			'api.maxRequestsPerMonth': 0,
			'api.requestsPerMinute': 60,
			'automation.enabled': true,
			'bookings.enabled': true,
			'bookings.maxRequestsPerMonth': 200,
			'forms.embeddedEnabled': true,
			'forms.hostedEnabled': true,
			'forms.maxForms': 3,
			'orders.enabled': true,
			'orders.maxPerMonth': 200,
			'payments.enabled': false,
			'platform.maxUsers': 3,
			'quotations.enabled': true,
			'quotations.maxPerMonth': 200,
			'webhooks.enabled': false,
			'whatsapp.enabled': true,
			'whatsapp.maxNumbers': 1,
			'whatsapp.maxOutboundPerMonth': 1000,
			'whatsapp.maxTemplates': 10,
			'whatsapp.templatesEnabled': false
		},
		limits: {
			api_requests_per_minute: 60,
			booking_requests_per_month: 200,
			whatsapp_outbound_per_month: 1000,
			api_keys: 2,
			members: 3
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: false,
			client_webhooks: false,
			multiple_numbers: false,
			custom_templates: false
		}
	},
	{
		code: 'BUSINESS',
		name: 'Business',
		priceMonthly: '99',
		sortOrder: 2,
		entitlements: {
			'ai.enabled': true,
			'api.enabled': true,
			'api.maxKeys': 5,
			'api.maxRequestsPerMonth': 0,
			'api.requestsPerMinute': 120,
			'automation.enabled': true,
			'bookings.enabled': true,
			'bookings.maxRequestsPerMonth': 1000,
			'forms.embeddedEnabled': true,
			'forms.hostedEnabled': true,
			'forms.maxForms': 10,
			'orders.enabled': true,
			'orders.maxPerMonth': 1000,
			'payments.enabled': true,
			'platform.maxUsers': 10,
			'quotations.enabled': true,
			'quotations.maxPerMonth': 1000,
			'webhooks.enabled': true,
			'whatsapp.enabled': true,
			'whatsapp.maxNumbers': 1,
			'whatsapp.maxOutboundPerMonth': 10000,
			'whatsapp.maxTemplates': 25,
			'whatsapp.templatesEnabled': true
		},
		limits: {
			api_requests_per_minute: 120,
			booking_requests_per_month: 1000,
			whatsapp_outbound_per_month: 10000,
			api_keys: 5,
			members: 10
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: false,
			custom_templates: true
		}
	},
	{
		code: 'PRO',
		name: 'Pro',
		priceMonthly: '249',
		sortOrder: 3,
		entitlements: {
			'ai.enabled': true,
			'api.enabled': true,
			'api.maxKeys': 15,
			'api.maxRequestsPerMonth': 0,
			'api.requestsPerMinute': 300,
			'automation.enabled': true,
			'bookings.enabled': true,
			'bookings.maxRequestsPerMonth': 5000,
			'forms.embeddedEnabled': true,
			'forms.hostedEnabled': true,
			'forms.maxForms': 50,
			'orders.enabled': true,
			'orders.maxPerMonth': 5000,
			'payments.enabled': true,
			'platform.maxUsers': 30,
			'quotations.enabled': true,
			'quotations.maxPerMonth': 5000,
			'webhooks.enabled': true,
			'whatsapp.enabled': true,
			'whatsapp.maxNumbers': 5,
			'whatsapp.maxOutboundPerMonth': 50000,
			'whatsapp.maxTemplates': 100,
			'whatsapp.templatesEnabled': true
		},
		limits: {
			api_requests_per_minute: 300,
			booking_requests_per_month: 5000,
			whatsapp_outbound_per_month: 50000,
			api_keys: 15,
			members: 30
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: true,
			custom_templates: true
		}
	},
	{
		code: 'ENTERPRISE',
		name: 'Enterprise',
		priceMonthly: '0',
		sortOrder: 4,
		entitlements: {
			'ai.enabled': true,
			'api.enabled': true,
			'api.maxKeys': 50,
			'api.maxRequestsPerMonth': 0,
			'api.requestsPerMinute': 1000,
			'automation.enabled': true,
			'bookings.enabled': true,
			'bookings.maxRequestsPerMonth': 0,
			'forms.embeddedEnabled': true,
			'forms.hostedEnabled': true,
			'forms.maxForms': 0,
			'orders.enabled': true,
			'orders.maxPerMonth': 0,
			'payments.enabled': true,
			'platform.maxUsers': 200,
			'quotations.enabled': true,
			'quotations.maxPerMonth': 0,
			'webhooks.enabled': true,
			'whatsapp.enabled': true,
			'whatsapp.maxNumbers': 0,
			'whatsapp.maxOutboundPerMonth': 0,
			'whatsapp.maxTemplates': 0,
			'whatsapp.templatesEnabled': true
		},
		limits: {
			api_requests_per_minute: 1000,
			booking_requests_per_month: 0,
			whatsapp_outbound_per_month: 0,
			api_keys: 50,
			members: 200
		},
		features: {
			whatsapp: true,
			quotations: true,
			payments: true,
			client_webhooks: true,
			multiple_numbers: true,
			custom_templates: true
		}
	}
];

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('Set DATABASE_URL (or SUPABASE_DB_URL).');
	process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

try {
	for (const plan of PLANS) {
		await db
			.insert(schema.plans)
			.values(plan as never)
			.onConflictDoUpdate({
				target: schema.plans.code,
				set: {
					name: plan.name,
					limits: plan.limits,
					features: plan.features,
					entitlements: plan.entitlements,
					priceMonthly: plan.priceMonthly,
					sortOrder: plan.sortOrder
				}
			});
	}
	console.log(`Seeded ${PLANS.length} plans.`);

	const email = process.env.SEED_SUPER_ADMIN_EMAIL;
	if (email) {
		const existing = (
			await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1)
		)[0];
		if (existing) {
			await db.update(schema.users).set({ isSuperAdmin: true }).where(eq(schema.users.id, existing.id));
			console.log(`Promoted existing user ${email} to super admin.`);
		} else {
			const password = process.env.SEED_SUPER_ADMIN_PASSWORD || `mk-${crypto.randomUUID().slice(0, 12)}`;
			await db.insert(schema.users).values({
				email: email.toLowerCase(),
				passwordHash: await hashPassword(password),
				fullName: 'Platform Admin',
				isSuperAdmin: true,
				// Seeded by an operator with database access — no verification link to send.
				emailVerifiedAt: new Date()
			});
			console.log(`Created super admin ${email}`);
			if (!process.env.SEED_SUPER_ADMIN_PASSWORD) console.log(`Temporary password: ${password}`);
		}
	} else {
		console.log('Set SEED_SUPER_ADMIN_EMAIL to create a platform admin.');
	}
} catch (err) {
	console.error('Seed failed:', (err as Error).message);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
