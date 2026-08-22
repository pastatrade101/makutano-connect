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

const PLANS = [
	{
		code: 'STARTER',
		name: 'Starter',
		priceMonthly: '29',
		sortOrder: 1,
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
				isSuperAdmin: true
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
