import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		alias: { $components: 'src/lib/components' },
		csrf: { trustedOrigins: [] },
		// Every deploy renames the hashed client chunks and deletes the old ones, so
		// a tab left open across a deploy is holding filenames the server no longer
		// has. Polling lets the client notice, and the root layout acts on it.
		version: { pollInterval: 60_000 }
	}
};

export default config;
