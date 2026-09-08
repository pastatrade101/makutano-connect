// Runs ONCE before the suite, and only against TEST_DATABASE_URL.
//
// `rate_limit_counters` is durable state keyed by client and a one-hour window,
// so it is the one table that makes the suite depend on how recently it last
// ran. Four runs in an hour and the public-enquiry tests start getting 429 where
// they assert 404 — a failure that says "the tenant-status check is broken" while
// the request never reached it. Clearing the table once per run costs nothing and
// makes every rate-limited test repeatable, rather than each one having to invent
// a client identity nothing else has used.
export async function setup() {
	const url = process.env.TEST_DATABASE_URL;
	if (!url) return;

	const { default: postgres } = await import('postgres');
	const sql = postgres(url, { max: 1, onnotice: () => {} });
	try {
		await sql`truncate table rate_limit_counters`;
	} catch {
		// A database built before that migration, or mid-rebuild. The suites that
		// care will say so themselves; failing global setup here would hide them.
	} finally {
		await sql.end({ timeout: 5 });
	}
}
