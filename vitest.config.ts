// Vitest is configured separately from vite.config.ts so the SvelteKit plugin (which
// expects a real dev/build pipeline) stays out of the unit-test run.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.{test,spec}.ts'],
		environment: 'node',
		globals: false,
		// The integration suite can run against a REMOTE Postgres (Supabase, eu-west-1),
		// where every round-trip costs hundreds of ms. These are latency budgets, not
		// slow tests: the same suite finishes in <1s against a local database.
		testTimeout: 120_000,
		hookTimeout: 60_000
	},
	resolve: {
		alias: {
			$lib: new URL('./src/lib', import.meta.url).pathname,
			'$env/dynamic/private': new URL('./tests/mocks/env-dynamic-private.ts', import.meta.url).pathname
		}
	}
});
