// Pin every database URL the app might read to TEST_DATABASE_URL — before any
// test file, and therefore before any import of src/lib/server/db.
//
// WHY THIS EXISTS: the individual suites set DATABASE_URL and nothing else, but
// src/lib/server/db/index.ts resolves `DIRECT_DATABASE_URL || DATABASE_URL`.
// Anyone who loads .env before running tests (`set -a; . ./.env; set +a`, which
// is what the README tells you to do for the migrator) therefore leaves
// DIRECT_DATABASE_URL pointing at PRODUCTION, and the suites happily provision
// their throwaway tenants into it. That is not hypothetical: it put 27 test
// tenants into the live database before this file existed.
//
// Pinning is not enough on its own — a TEST_DATABASE_URL that is itself the
// production database would sail straight through — so the obvious markers are
// refused outright. This is a seatbelt, not a security control: the real
// guarantee is pointing TEST_DATABASE_URL at a database you are happy to lose.
const url = process.env.TEST_DATABASE_URL;

if (url) {
	const looksManaged = /supabase\.(co|com)|neon\.tech|rds\.amazonaws\.com|\.render\.com/i.test(url);
	const poolerPort = /:6543\//.test(url);
	if (looksManaged || poolerPort) {
		throw new Error(
			`TEST_DATABASE_URL points at what looks like a hosted/production database (${url.replace(/:[^:@/]*@/, ':***@')}). ` +
				'The suites drop and recreate tenants. Point it at a throwaway database.'
		);
	}
	// Every name the app or its scripts might resolve, so none of them can win.
	process.env.DATABASE_URL = url;
	process.env.DIRECT_DATABASE_URL = url;
	process.env.SUPABASE_DB_URL = url;
} else {
	// No test database: make sure a stray production URL cannot be picked up by a
	// suite that forgot to guard itself. The db-backed suites skip in this case.
	delete process.env.DIRECT_DATABASE_URL;
	delete process.env.SUPABASE_DB_URL;
	process.env.DATABASE_URL = 'postgres://localhost:5432/unused';
}
