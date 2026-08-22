// Zod-validated server environment (§30). Validated once at startup via assertEnv()
// in hooks.server.ts so a misconfigured deployment fails loudly instead of silently
// degrading. Nothing in this module may ever be imported from client code — it lives
// under $lib/server, which SvelteKit refuses to bundle into the browser.
import { env as dynamicEnv } from '$env/dynamic/private';
import { z } from 'zod';

const schema = z.object({
	// --- Required in production ---
	// Supabase IS Postgres, so its connection string goes here. Use the TRANSACTION
	// POOLER URL (port 6543) for the running app — the pool sets prepare:false, which is
	// exactly what that pooler requires — and the DIRECT url (port 5432) for migrations,
	// since DDL and advisory locks need a session connection.
	DATABASE_URL: z.string().min(1, 'DATABASE_URL (or SUPABASE_DB_URL) is required'),
	// Optional session-mode connection used by scripts/migrate.ts.
	DIRECT_DATABASE_URL: z.string().default(''),
	PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
	AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
	CREDENTIALS_ENCRYPTION_KEY: z.string().min(16, 'CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters'),

	// --- Meta / WhatsApp (§7) — optional until WhatsApp is switched on ---
	META_APP_ID: z.string().default(''),
	META_APP_SECRET: z.string().default(''),
	META_GRAPH_VERSION: z.string().default('v23.0'),
	WHATSAPP_CONFIG_ID: z.string().default(''),
	WHATSAPP_VERIFY_TOKEN: z.string().default(''),

	// --- Infrastructure ---
	REDIS_URL: z.string().default(''),
	EMAIL_FROM: z.string().default(''),
	EMAIL_PROVIDER_KEY: z.string().default(''),

	// --- Behaviour flags ---
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	JOB_WORKER: z.enum(['on', 'off']).default('on'),
	JOB_POLL_MS: z.coerce.number().int().min(200).default(2000),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
	DB_POOL_MAX: z.coerce.number().int().min(1).default(10)
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function raw(): Record<string, string | undefined> {
	// $env/dynamic/private during a request; process.env for scripts and tests.
	let source: Record<string, string | undefined>;
	try {
		source = { ...process.env, ...dynamicEnv } as Record<string, string | undefined>;
	} catch {
		source = process.env as Record<string, string | undefined>;
	}
	// SUPABASE_DB_URL is accepted as an alias so a Supabase-hosted deployment can use the
	// name it already thinks in. It is the same Postgres connection string either way.
	if (!source.DATABASE_URL && source.SUPABASE_DB_URL) {
		source = { ...source, DATABASE_URL: source.SUPABASE_DB_URL };
	}
	return source;
}

/** Parsed environment. Throws a single aggregated error listing every problem. */
export function env(): Env {
	if (cached) return cached;
	const parsed = schema.safeParse(raw());
	if (!parsed.success) {
		const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
		throw new Error(`Invalid environment configuration:\n${problems}`);
	}
	cached = parsed.data;
	return cached;
}

/** Call once at startup. Logs a summary of which optional subsystems are live. */
export function assertEnv(): Env {
	const e = env();
	return e;
}

/** True once Embedded Signup can run end-to-end (§7). */
export function embeddedSignupReady(): boolean {
	const e = env();
	return !!(e.META_APP_ID && e.META_APP_SECRET && e.WHATSAPP_CONFIG_ID && e.CREDENTIALS_ENCRYPTION_KEY);
}

export function isProduction(): boolean {
	return env().NODE_ENV === 'production';
}

/** Reset the cache — tests only. */
export function __resetEnvCache(): void {
	cached = null;
}
