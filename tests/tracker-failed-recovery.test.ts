// A failed setup must look failed.
//
// The audit found a FAILED enrollment rendering as "no tracking configured":
// enrollmentFor returned only ACTIVE and in-flight rows, so a vehicle whose
// provisioning had exhausted its attempts showed the operator an empty setup
// screen. Two branches downstream DID test for FAILED — and could never fire,
// because `pending` only ever holds PENDING or PROVISIONED. The intent was
// written; the query made it unreachable.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

process.env.DATABASE_URL ||= 'postgres://localhost:5432/unused';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.JOB_WORKER = 'off';

const read = (p: string) => readFileSync(p, 'utf8');
const SERVICE = read('src/lib/server/tracking/enrollment.ts');
const WORKER = read('src/lib/server/tracking/provisioning-worker.ts');
const MIGRATION = read('drizzle/0050_tracker_enrollments.sql');
const PAGE = read('src/routes/app/vehicles/[id]/tracking/+page.server.ts');

const MINUTE = 60_000;
let seq = 0;
/** Only the fields the view actually reads; the rest of the row is irrelevant here. */
function row(status: string, opts: { expiresInMs?: number; createdAgoMs?: number } = {}) {
	seq += 1;
	return {
		id: `enr-${seq}`,
		status,
		expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 10 * MINUTE)),
		createdAt: new Date(Date.now() - (opts.createdAgoMs ?? seq * 1000))
	} as never;
}

describe('a failed enrollment is visible, and recoverable', () => {
	it('reaches FAILED only on the sixth attempt, and stays there', async () => {
		const { retryPlan } = await import('$lib/server/tracking/provisioning-worker');
		// PENDING through five failures...
		for (const n of [1, 2, 3, 4, 5]) expect(retryPlan(n).terminal).toBe(false);
		// ...then terminal, which is the write that sets FAILED.
		expect(retryPlan(6).terminal).toBe(true);
		expect(WORKER).toContain("status: terminal ? 'FAILED' : 'PENDING'");
	});

	it('surfaces a FAILED row that nothing else supersedes', async () => {
		const { selectEnrollmentView } = await import('$lib/server/tracking/enrollment');
		const failed = row('FAILED');
		const view = selectEnrollmentView([failed]);
		expect(view.failed).toBe(failed);
		expect(view.active).toBeNull();
		expect(view.pending).toBeNull();
	});

	it('reports the most recent failure when a vehicle has failed twice', async () => {
		const { selectEnrollmentView } = await import('$lib/server/tracking/enrollment');
		const older = row('FAILED', { createdAgoMs: 60 * MINUTE });
		const newer = row('FAILED', { createdAgoMs: 1 * MINUTE });
		expect(selectEnrollmentView([older, newer]).failed).toBe(newer);
		expect(selectEnrollmentView([newer, older]).failed).toBe(newer);
	});

	it('hides the failure the moment a retry is in flight — without touching the ledger', async () => {
		const { selectEnrollmentView } = await import('$lib/server/tracking/enrollment');
		const failed = row('FAILED', { createdAgoMs: 30 * MINUTE });
		const retry = row('PENDING');
		const view = selectEnrollmentView([failed, retry]);
		expect(view.pending).toBe(retry);
		expect(view.failed).toBeNull();
		// The failure row is still in the input, unmodified: the view is a read.
		expect(failed).toMatchObject({ status: 'FAILED' });
	});

	it('an ACTIVE tracker outranks a historical failure', async () => {
		const { selectEnrollmentView } = await import('$lib/server/tracking/enrollment');
		const view = selectEnrollmentView([row('FAILED', { createdAgoMs: 5 * MINUTE }), row('ACTIVE')]);
		expect(view.active).not.toBeNull();
		expect(view.failed).toBeNull();
	});

	it('an expired code is still reported as expired, not as failed', async () => {
		const { selectEnrollmentView } = await import('$lib/server/tracking/enrollment');
		const view = selectEnrollmentView([row('PROVISIONED', { expiresInMs: -MINUTE })]);
		expect(view.expired).not.toBeNull();
		expect(view.pending).toBeNull();
		expect(view.failed).toBeNull();
	});

	it('never leaks the provider reason to the operator', () => {
		// lastError holds whatever the provider said — it names the provider, its
		// endpoint, and sometimes the identifier it rejected.
		const failedBranch = SERVICE.slice(
			SERVICE.indexOf('if (failed) return'),
			SERVICE.indexOf('if (failed) return') + 120
		);
		expect(failedBranch).toContain('lastError: null');
		expect(PAGE).toContain('failed: Boolean(failed)');
		expect(PAGE).not.toMatch(/lastError/);
	});

	it('retrying does not delete or rewrite the failed row', () => {
		// startEnrollment closes stale work before inserting. Both statements are
		// scoped to in-flight rows; if FAILED were ever added here, the ledger would
		// lose the evidence that anything went wrong.
		// Three statements scope themselves this way — the two self-heals in
		// startEnrollment and cancelEnrollment. What matters is not how many there
		// are but that none of them can reach a FAILED row.
		const closes = SERVICE.match(/status IN \('PENDING','PROVISIONED'\)/g) ?? [];
		expect(closes.length).toBeGreaterThanOrEqual(2);
		expect(SERVICE).not.toMatch(/delete\(\s*schema\.trackerEnrollments/);
		expect(SERVICE).not.toMatch(/status IN \([^)]*'FAILED'/);
	});

	it('cannot produce a second in-flight or active enrollment for a vehicle', () => {
		// The retry path relies on these: a FAILED row is outside both partial
		// indexes, so a new attempt inserts — and no second live one ever can.
		expect(MIGRATION).toContain(
			"te_one_inflight_key ON tracker_enrollments (vehicle_id) WHERE status IN ('PENDING','PROVISIONED')"
		);
		expect(MIGRATION).toContain("te_one_active_key ON tracker_enrollments (vehicle_id) WHERE status = 'ACTIVE'");
		// And an identifier is never reused, whatever the row's fate.
		expect(MIGRATION).toContain(
			"te_ref_forever_key ON tracker_enrollments (provider, device_ref) WHERE status <> 'RELEASED'"
		);
	});

	it('reads the ledger only within one tenant', () => {
		const fn = SERVICE.slice(SERVICE.indexOf('export async function enrollmentFor'));
		expect(fn).toContain('eq(schema.trackerEnrollments.tenantId, tenantId)');
		expect(fn.indexOf('tenantId')).toBeLessThan(fn.indexOf('vehicleId'));
	});
});
