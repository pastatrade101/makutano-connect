// A vendor must not be able to put their own listing in front of the public.
//
// Two separate guarantees are at stake and both are tested from the outside:
//
//   1. Status is not an ordinary column. Every move is an explicit, named
//      transition — so the matrix below asserts EVERY (status, action) pair,
//      not just the happy path. A lifecycle that only rejects the cases
//      somebody remembered is not a lifecycle.
//   2. The four review steps are platform-only. The service takes `canPublish`
//      as an argument rather than reading the permission itself, so the test
//      can drive exactly what a vendor request would look like.
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

const VENDOR = { canPublish: false };
const PLATFORM = { canPublish: true };

type Status =
	| 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'CHANGES_REQUESTED'
	| 'APPROVED' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';
type Action =
	| 'submit' | 'start_review' | 'approve' | 'request_changes'
	| 'publish' | 'unpublish' | 'archive' | 'restore';

/** The lifecycle, restated independently of the implementation. */
const LEGAL: Record<Action, { from: Status[]; to: Status; platform: boolean }> = {
	submit:          { from: ['DRAFT', 'CHANGES_REQUESTED', 'UNPUBLISHED'], to: 'SUBMITTED', platform: false },
	start_review:    { from: ['SUBMITTED'], to: 'IN_REVIEW', platform: true },
	approve:         { from: ['SUBMITTED', 'IN_REVIEW'], to: 'APPROVED', platform: true },
	request_changes: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'CHANGES_REQUESTED', platform: true },
	// UNPUBLISHED as well as APPROVED: a listing pulled from the marketplace has to
	// be something the platform can put back, or the admin who took it down has to
	// ask the operator to resubmit for a whole review round.
	publish:         { from: ['APPROVED', 'UNPUBLISHED'], to: 'PUBLISHED', platform: true },
	unpublish:       { from: ['PUBLISHED'], to: 'UNPUBLISHED', platform: false },
	archive:         { from: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'UNPUBLISHED'], to: 'ARCHIVED', platform: false },
	restore:         { from: ['ARCHIVED'], to: 'DRAFT', platform: false }
};

const ALL_STATUSES: Status[] = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'];
const ALL_ACTIONS = Object.keys(LEGAL) as Action[];

suite('marketplace listing moderation', () => {
	let tenantId: string;
	let countryId: string;
	let destinationId: string;
	let categoryId: string;
	let mediaId: string;
	let T: typeof import('../src/lib/server/tours');
	let db: typeof import('../src/lib/server/db')['db'];
	let schema: typeof import('../src/lib/server/db')['schema'];
	let eq: typeof import('drizzle-orm')['eq'];

	beforeAll(async () => {
		const tenant = await provisionTestTenant({ name: 'Moderation Co', slug: `test-mod-${Date.now()}` } as never);
		tenantId = tenant.id;
		T = await import('../src/lib/server/tours');
		({ db, schema } = await import('../src/lib/server/db'));
		({ eq } = await import('drizzle-orm'));
		const { liftLimits } = await import('./support');
		await liftLimits(tenantId);

		const [c] = await db().select().from(schema.countries).where(eq(schema.countries.slug, 'tanzania')).limit(1);
		countryId = c.id;
		const [d] = await db().select().from(schema.destinations).where(eq(schema.destinations.slug, 'serengeti-national-park')).limit(1);
		destinationId = d.id;
		// A listing with no category appears under no category filter, so
		// assertPublishable now counts one as missing.
		const [cat] = await db().select().from(schema.tourCategories).where(eq(schema.tourCategories.slug, 'safari')).limit(1);
		categoryId = cat.id;
		// A media row stands in for an uploaded hero; publishability requires one.
		const [m] = await db().insert(schema.media).values({
			tenantId, objectKey: `probe/${Date.now()}.jpg`, url: 'https://example.test/hero.jpg', mimeType: 'image/jpeg'
		}).returning();
		mediaId = m.id;
	}, 120_000);

	/** A listing that satisfies every publishability rule. */
	const publishableTour = async () => {
		const tour = await T.createTour(tenantId, {
			title: `Matrix Probe ${Math.random().toString(36).slice(2, 8)}`,
			primaryCountryId: countryId,
			shortDescription: 'A complete listing.',
			durationDays: 3,
			priceFrom: '1200.00',
			currency: 'USD',
			primaryCategoryId: categoryId,
			heroMediaId: mediaId
		});
		await T.setTourDestinations(tenantId, tour.id, [destinationId]);
		await T.replaceItinerary(tenantId, tour.id, [
			{ dayNumber: 1, title: 'Arrive' }, { dayNumber: 2, title: 'Drive' }, { dayNumber: 3, title: 'Depart' }
		] as never);
		return tour;
	};

	const setStatus = async (id: string, status: Status) =>
		db().update(schema.tours).set({ status }).where(eq(schema.tours.id, id));

	const statusOf = async (id: string): Promise<Status> => {
		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, id)).limit(1);
		return row.status as Status;
	};

	/* ---- the happy path -------------------------------------------------- */

	it('walks the full lifecycle with the right hands on each step', async () => {
		const tour = await publishableTour();

		await T.transitionTour(tenantId, tour.id, 'submit', {}, VENDOR);
		expect(await statusOf(tour.id)).toBe('SUBMITTED');

		await T.transitionTour(tenantId, tour.id, 'start_review', {}, PLATFORM);
		expect(await statusOf(tour.id)).toBe('IN_REVIEW');

		await T.transitionTour(tenantId, tour.id, 'approve', {}, PLATFORM);
		expect(await statusOf(tour.id)).toBe('APPROVED');

		const published = await T.transitionTour(tenantId, tour.id, 'publish', {}, PLATFORM);
		expect(published.status).toBe('PUBLISHED');
		expect(published.publishedAt, 'publishing stamps when it went live').toBeTruthy();

		// A vendor may pull their OWN listing down — that is not a moderation act.
		await T.transitionTour(tenantId, tour.id, 'unpublish', {}, VENDOR);
		expect(await statusOf(tour.id)).toBe('UNPUBLISHED');
	});

	it('sends a listing back for changes, with a note the operator will read', async () => {
		const tour = await publishableTour();
		await T.transitionTour(tenantId, tour.id, 'submit', {}, VENDOR);

		await expect(
			T.transitionTour(tenantId, tour.id, 'request_changes', {}, PLATFORM),
			'a rejection with no reason is useless to the operator'
		).rejects.toThrow();

		const changed = await T.transitionTour(tenantId, tour.id, 'request_changes', {}, { ...PLATFORM, note: 'Add a price.' });
		expect(changed.status).toBe('CHANGES_REQUESTED');
		expect(changed.reviewNote).toBe('Add a price.');

		await T.transitionTour(tenantId, tour.id, 'submit', {}, VENDOR);
		expect(await statusOf(tour.id)).toBe('SUBMITTED');
	});

	/* ---- what a vendor may never do -------------------------------------- */

	it('refuses every platform-only step to a vendor, from every state it could be tried', async () => {
		const platformActions = ALL_ACTIONS.filter((a) => LEGAL[a].platform);
		expect(platformActions).toEqual(['start_review', 'approve', 'request_changes', 'publish']);

		for (const action of platformActions) {
			for (const from of LEGAL[action].from) {
				const tour = await publishableTour();
				await setStatus(tour.id, from);
				await expect(
					T.transitionTour(tenantId, tour.id, action, {}, { ...VENDOR, note: 'x' }),
					`vendor must not ${action} from ${from}`
				).rejects.toThrow(/marketplace team|FORBIDDEN|Only the/i);
				// And the refusal must not have moved anything.
				expect(await statusOf(tour.id), `${action} from ${from} must not change status`).toBe(from);
			}
		}
	});

	it('does not let a generic update set status or featured', async () => {
		// The hole this closes: a vendor PATCHing { status: 'PUBLISHED' } straight
		// onto the row and skipping moderation entirely.
		const tour = await publishableTour();
		await T.updateTour(tenantId, tour.id, {
			title: 'Renamed',
			status: 'PUBLISHED',
			featured: true,
			publishedAt: new Date()
		} as never);

		const [row] = await db().select().from(schema.tours).where(eq(schema.tours.id, tour.id)).limit(1);
		expect(row.title).toBe('Renamed');
		expect(row.status, 'status is not an ordinary column').toBe('DRAFT');
		expect(row.featured, 'featuring is a platform decision').toBe(false);
		expect(row.publishedAt).toBeNull();
	});

	/* ---- the exhaustive matrix ------------------------------------------- */

	it('accepts ONLY the legal (status, action) pairs — all 64 checked', async () => {
		const platform = { canPublish: true, note: 'because' };
		let legal = 0;
		let rejected = 0;

		for (const from of ALL_STATUSES) {
			for (const action of ALL_ACTIONS) {
				const tour = await publishableTour();
				await setStatus(tour.id, from);
				const shouldPass = LEGAL[action].from.includes(from);

				if (shouldPass) {
					const after = await T.transitionTour(tenantId, tour.id, action, {}, platform);
					expect(after.status, `${from} --${action}--> should be ${LEGAL[action].to}`).toBe(LEGAL[action].to);
					legal++;
				} else {
					await expect(
						T.transitionTour(tenantId, tour.id, action, {}, platform),
						`${from} --${action}--> must be refused`
					).rejects.toThrow();
					expect(await statusOf(tour.id), `refused ${action} must leave ${from} alone`).toBe(from);
					rejected++;
				}
			}
		}

		expect(legal + rejected).toBe(ALL_STATUSES.length * ALL_ACTIONS.length);
		expect(legal).toBe(Object.values(LEGAL).reduce((n, r) => n + r.from.length, 0));
	}, 180_000);

	/* ---- publishability --------------------------------------------------- */

	it('will not let an incomplete listing be submitted, and says what is missing', async () => {
		const bare = await T.createTour(tenantId, { title: 'Bare Listing' });
		const missing = await T.assertPublishable(tenantId, bare.id);

		expect(missing).toEqual(
			expect.arrayContaining([
				'a short description', 'a country', 'a starting price', 'a currency',
				'a main photo', 'at least one itinerary day', 'at least one destination'
			])
		);

		await expect(T.transitionTour(tenantId, bare.id, 'submit', {}, VENDOR)).rejects.toThrow(/still needs/i);
		expect(await statusOf(bare.id)).toBe('DRAFT');
	});

	it('reports nothing missing once the listing is complete', async () => {
		const tour = await publishableTour();
		expect(await T.assertPublishable(tenantId, tour.id)).toEqual([]);
	});
});
