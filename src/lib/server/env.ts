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

	// --- AI assist (§ai) — optional; every AI surface is off without a key ---
	ANTHROPIC_API_KEY: z.string().default(''),
	// Firebase service-account JSON, one line. Absent = no push, no error.
	FCM_SERVICE_ACCOUNT: z.string().default(''),
	// Model is configurable so the platform can trade cost for capability without a
	// deploy-time code change. Extraction runs at low effort, which is where most of
	// the saving comes from.
	AI_MODEL: z.string().default('claude-opus-5'),
	// Emergency stop for every AI call, platform-wide. No deploy, no plan edits.
	AI_ENABLED: z.enum(['on', 'off']).default('on'),

	// --- Infrastructure ---
	REDIS_URL: z.string().default(''),
	EMAIL_FROM: z.string().default(''),
	EMAIL_PROVIDER: z.enum(['resend', 'none']).default('resend'),
	EMAIL_PROVIDER_KEY: z.string().default(''),

	// --- Self-signup (§ client onboarding) ---
	SIGNUP_ENABLED: z.enum(['on', 'off']).default('on'),
	// Plan a visitor lands on when they do not pick one.
	SIGNUP_DEFAULT_PLAN: z.string().default('STARTER'),
	// 0 disables trials entirely — new tenants then wait in PENDING for activation.
	SIGNUP_TRIAL_DAYS: z.coerce.number().int().min(0).max(365).default(14),
	// Cloudflare Turnstile. Both blank = no challenge; the code path is already wired.
	TURNSTILE_SITE_KEY: z.string().default(''),
	TURNSTILE_SECRET_KEY: z.string().default(''),

	// --- Behaviour flags ---
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	JOB_WORKER: z.enum(['on', 'off']).default('on'),
	JOB_POLL_MS: z.coerce.number().int().min(200).default(2000),
	LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
	/**
	 * Connection pool size — and it must stay ABOVE the app's peak concurrent fan-out.
	 *
	 * Measured against Supabase's transaction pooler: issuing more queries at once than
	 * `max` wedges the client permanently. postgres-js pipelines the overflow onto
	 * in-use connections, Supavisor does not answer them, and the queue never drains —
	 * the request hangs forever while the database shows only idle connections, so it
	 * never surfaces as a lock, a slow query or an error. The same overflow against a
	 * DIRECT session connection queues correctly and completes.
	 *
	 * A single page here already fans out 8-10 queries (admin Control Center, portal
	 * dashboard), so 10 was one concurrent request away from wedging the process.
	 */
	DB_POOL_MAX: z.coerce.number().int().min(1).default(25),

	// --- Cloudflare R2 (§35 marketplace media) ---
	// Optional: with any of these unset, media upload is simply unavailable and
	// every other feature is untouched. The account id, key and secret are
	// SERVER-ONLY — they are never returned by an API, never rendered into a
	// page, and never used to mint a browser-side upload URL. Uploads are
	// proxied through Connect, which is what keeps the bucket credentials off
	// the client entirely.
	R2_ACCOUNT_ID: z.string().default(''),
	R2_ACCESS_KEY_ID: z.string().default(''),
	R2_SECRET_ACCESS_KEY: z.string().default(''),
	R2_BUCKET_NAME: z.string().default(''),
	/** Public CDN origin for the bucket. The only R2 value a browser ever sees. */
	R2_PUBLIC_URL: z.string().default('')
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
/**
 * The unparsed environment as it is RIGHT NOW. Almost everything should use env(),
 * which validates once and caches — this exists for the few switches that must take
 * effect the moment they change, such as the AI emergency stop.
 */
export function liveEnv(): Record<string, string | undefined> {
	return raw();
}

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

/** True when verification email can actually leave the building. */
export function emailReady(): boolean {
	const e = env();
	return e.EMAIL_PROVIDER !== 'none' && !!e.EMAIL_PROVIDER_KEY && !!e.EMAIL_FROM;
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
