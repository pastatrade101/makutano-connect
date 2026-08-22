// Test stand-in for SvelteKit's $env/dynamic/private, which only exists inside a
// SvelteKit build. Unit tests read the real process.env instead.
export const env = process.env as Record<string, string | undefined>;
