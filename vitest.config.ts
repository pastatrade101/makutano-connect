// Vitest is configured separately from vite.config.ts so the SvelteKit plugin (which
// expects a real dev/build pipeline) stays out of the unit-test run.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.{test,spec}.ts'],
		// Runs before any test file, so no suite can reach a database other than
		// TEST_DATABASE_URL — see the comment in that file for what went wrong
		// without it.
		setupFiles: ['./tests/pin-database.ts'],
		environment: 'node',
		globals: false,
		// The integration suite can run against a REMOTE Postgres (Supabase, eu-west-1),
		// where every round-trip costs hundreds of ms. These are latency budgets, not
		// slow tests: the same suite finishes in <1s against a local database.
		testTimeout: 120_000,
		hookTimeout: 60_000,
		/**
		 * Bound how many test FILES run at once.
		 *
		 * Each file opens its own connection pool against the same database, so
		 * unbounded parallelism scales connections with the number of suites and
		 * eventually exhausts Postgres's `max_connections` (100 by default). What
		 * that looks like is NOT a connection error — it is a handful of unrelated
		 * tests sitting at the 120s timeout while they wait for a connection that
		 * never frees, which sent me chasing imaginary lock contention.
		 *
		 * Six workers × the small per-file pool pinned in tests/pin-database.ts
		 * stays comfortably under any default install.
		 */
		poolOptions: { threads: { maxThreads: 6, minThreads: 1 } }
	},
	resolve: {
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname,
			'$env/dynamic/private': new URL('./tests/mocks/env-dynamic-private.ts', import.meta.url).pathname
		}
	}
});
