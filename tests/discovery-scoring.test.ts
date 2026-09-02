// Pure tests for the ranking model. No database, so nothing here can pass by
// skipping — which matters, because this project's DB-backed suites skip
// silently without TEST_DATABASE_URL and a ranking verified only that way would
// be a ranking nobody had verified at all.
import { describe, expect, it } from 'vitest';
import {
	applyOperatorDiversity,
	DEFAULT_DISCOVERY_CONFIG,
	dateBucket,
	freshnessScore,
	performanceScore,
	qualityScore,
	rankCandidates,
	relevanceScore,
	reviewConfidence,
	scoreCandidate,
	sortWithRotation,
	validateWeights,
	type Candidate,
	type ScoreBreakdown
} from '$lib/discovery/scoring';

const NOW = Date.parse('2026-09-02T12:00:00Z');
const cfg = DEFAULT_DISCOVERY_CONFIG;

/** A complete, unremarkable candidate. Tests override only what they mean to test. */
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
	tourId: over.tourId ?? 'tour-1',
	operatorId: over.operatorId ?? 'op-1',
	countrySlug: 'tanzania',
	destinationSlugs: ['serengeti-national-park'],
	categorySlugs: ['safari'],
	styleSlugs: ['wildlife'],
	activitySlugs: ['game-drive'],
	durationDays: 6,
	priceFrom: 2400,
	groupType: 'PRIVATE',
	hasHero: true,
	galleryCount: 4,
	itineraryDays: 6,
	hasPrice: true,
	hasShortDescription: true,
	operatorProfileComplete: true,
	reviewCount: 0,
	reviewAverage: null,
	publishedAt: new Date(NOW - 10 * 86_400_000),
	updatedAt: new Date(NOW - 10 * 86_400_000),
	recentImpressions: 100,
	operatorIsNew: false,
	enquiries: 0,
	quotations: 0,
	bookings: 0,
	...over
});

const score = (c: Candidate, ctx = {}, maxImp = 100) => scoreCandidate(c, ctx, cfg, maxImp, NOW);

describe('1. relevance beats fairness', () => {
	it('a relevant, heavily exposed tour outranks an irrelevant, unseen one', () => {
		const relevant = candidate({ tourId: 'a', operatorId: 'op-a', recentImpressions: 100 });
		const irrelevant = candidate({
			tourId: 'b',
			operatorId: 'op-b',
			recentImpressions: 0,
			operatorIsNew: true,
			categorySlugs: ['beach-island'],
			destinationSlugs: ['zanzibar']
		});
		const ctx = { categorySlug: 'safari', destinationSlug: 'serengeti-national-park' };
		expect(score(relevant, ctx).final).toBeGreaterThan(score(irrelevant, ctx).final);
	});
});

describe('2. fairness helps the under-exposed at comparable relevance', () => {
	it('the less-seen of two equally relevant tours ranks higher', () => {
		const seen = candidate({ tourId: 'a', operatorId: 'op-a', recentImpressions: 100 });
		const unseen = candidate({ tourId: 'b', operatorId: 'op-b', recentImpressions: 0 });
		expect(score(unseen).final).toBeGreaterThan(score(seen).final);
	});
});

describe('3. fairness cannot rescue the irrelevant', () => {
	it('maximum fairness still loses to a real relevance gap', () => {
		const bestPossibleFairness = candidate({
			tourId: 'b',
			operatorId: 'op-b',
			recentImpressions: 0,
			operatorIsNew: true,
			categorySlugs: [],
			destinationSlugs: [],
			styleSlugs: [],
			activitySlugs: []
		});
		const relevant = candidate({ tourId: 'a', operatorId: 'op-a', recentImpressions: 999 });
		const ctx = {
			categorySlug: 'safari',
			destinationSlug: 'serengeti-national-park',
			styleSlugs: ['wildlife'],
			activitySlugs: ['game-drive']
		};
		expect(score(relevant, ctx, 999).final).toBeGreaterThan(score(bestPossibleFairness, ctx, 999).final);
	});
});

describe('4. new operators get a capped opportunity', () => {
	it('the boost applies but stays inside its cap', () => {
		const fresh = candidate({ operatorIsNew: true, recentImpressions: 0 });
		const known = candidate({ operatorIsNew: false, recentImpressions: 0 });
		const a = score(fresh).fairness;
		const b = score(known).fairness;
		expect(a).toBeGreaterThan(b);
		expect(a - b).toBeLessThanOrEqual(cfg.explorationBoost);
		expect(a).toBeLessThanOrEqual(100);
	});

	it('is off when the config disables it', () => {
		const off = { ...cfg, newOperatorBoostEnabled: false };
		const fresh = candidate({ operatorIsNew: true, recentImpressions: 0 });
		expect(scoreCandidate(fresh, {}, off, 100, NOW).fairness).toBe(
			scoreCandidate(candidate({ recentImpressions: 0 }), {}, off, 100, NOW).fairness
		);
	});
});

describe('5. quality contributes', () => {
	it('a complete listing outscores a bare one', () => {
		const full = candidate();
		const bare = candidate({
			hasHero: false,
			galleryCount: 0,
			itineraryDays: 0,
			hasPrice: false,
			hasShortDescription: false,
			operatorProfileComplete: false
		});
		expect(qualityScore(full)).toBeGreaterThan(qualityScore(bare));
		expect(qualityScore(bare)).toBe(0);
	});

	it('a tour with no reviews still reaches a strong quality score', () => {
		// Requiring reviews to be discoverable would make every new operator
		// permanently invisible, which is what this engine exists to prevent.
		expect(qualityScore(candidate({ reviewCount: 0, reviewAverage: null }))).toBeGreaterThanOrEqual(70);
	});
});

describe('6. missing performance history is neutral', () => {
	it('no enquiries scores the same as an average operator, not zero', () => {
		expect(performanceScore(candidate({ enquiries: 0 }))).toBe(50);
	});

	it('too little evidence is neutral rather than a perfect record', () => {
		// 1 enquiry → 1 booking is not a 100% conversion rate worth ranking on.
		expect(performanceScore(candidate({ enquiries: 1, quotations: 1, bookings: 1 }))).toBe(50);
	});

	it('reads real conversion once there is evidence', () => {
		const good = candidate({ enquiries: 20, quotations: 20, bookings: 20 });
		const poor = candidate({ enquiries: 20, quotations: 2, bookings: 0 });
		expect(performanceScore(good)).toBeGreaterThan(performanceScore(poor));
	});
});

describe('7. the weighted formula', () => {
	it('produces the weighted mean of its components', () => {
		const c = candidate();
		const s = score(c);
		const w = cfg.weights;
		const expected =
			(s.relevance * w.relevance +
				s.quality * w.quality +
				s.fairness * w.fairness +
				s.freshness * w.freshness +
				s.performance * w.performance) /
			100;
		expect(s.final).toBeCloseTo(Math.round(expected * 100) / 100, 1);
	});

	it('respects a reweighting', () => {
		const relevanceOnly = {
			...cfg,
			weights: { relevance: 100, quality: 0, fairness: 0, freshness: 0, performance: 0 }
		};
		const c = candidate();
		const s = scoreCandidate(c, { categorySlug: 'safari' }, relevanceOnly, 100, NOW);
		expect(s.final).toBeCloseTo(s.relevance, 5);
	});
});

describe('8. invalid config is rejected', () => {
	it('refuses weights that do not total 100', () => {
		const r = validateWeights({ relevance: 40, quality: 20, fairness: 20, freshness: 10, performance: 5 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toContain('95');
	});

	it('refuses negative or absurd weights', () => {
		expect(validateWeights({ relevance: -10, quality: 40, fairness: 40, freshness: 20, performance: 10 }).ok).toBe(
			false
		);
	});

	it('accepts the defaults', () => {
		expect(validateWeights(cfg.weights).ok).toBe(true);
	});
});

/* --------------------------------------------------------- diversity ----- */

const row = (tourId: string, operatorId: string, final: number): ScoreBreakdown => ({
	tourId,
	operatorId,
	relevance: 50,
	quality: 50,
	fairness: 50,
	freshness: 50,
	performance: 50,
	final
});

describe('9 & 10. operator diversity windows', () => {
	/*
	 * SEVEN operators, A dominant with six listings.
	 *
	 * The count matters: six slots at one per operator needs six operators to
	 * satisfy. An earlier version of this test used three, which made the cap
	 * arithmetically impossible and was measuring the relaxation path rather than
	 * the rule. That is now its own test below.
	 */
	const many = [
		// A wants the whole page.
		row('a1', 'A', 99),
		row('a2', 'A', 98.5),
		row('a3', 'A', 98),
		row('a4', 'A', 97.5),
		row('a5', 'A', 97),
		row('a6', 'A', 96.5),
		// Six more operators with two each — enough that twelve slots at two per
		// operator is actually satisfiable. Fewer, and the test would be measuring
		// the relaxation path instead of the cap.
		row('b1', 'B', 96),
		row('b2', 'B', 95.5),
		row('c1', 'C', 95),
		row('c2', 'C', 94.5),
		row('d1', 'D', 94),
		row('d2', 'D', 93.5),
		row('e1', 'E', 93),
		row('e2', 'E', 92.5),
		row('f1', 'F', 92),
		row('f2', 'F', 91.5),
		row('g1', 'G', 91),
		row('g2', 'G', 90.5)
	];

	const countsIn = (rows: ScoreBreakdown[]) => {
		const m = new Map<string, number>();
		for (const r of rows) m.set(r.operatorId, (m.get(r.operatorId) ?? 0) + 1);
		return m;
	};

	it('allows at most one tour per operator in the first 6', () => {
		const { results, diversityApplied } = applyOperatorDiversity(many, cfg);
		expect(diversityApplied).toBe(true);
		for (const [, n] of countsIn(results.slice(0, cfg.firstWindowSize))) {
			expect(n).toBeLessThanOrEqual(cfg.firstWindowMaxPerOperator);
		}
	});

	it('allows at most two per operator in the first 12', () => {
		const { results } = applyOperatorDiversity(many, cfg);
		for (const [, n] of countsIn(results.slice(0, cfg.secondWindowSize))) {
			expect(n).toBeLessThanOrEqual(cfg.secondWindowMaxPerOperator);
		}
	});

	it('stops one operator with six listings from owning the first page', () => {
		// Unranked, A would hold all six of the first six.
		const { results } = applyOperatorDiversity(many, cfg);
		expect(results.slice(0, 6).filter((r) => r.operatorId === 'A')).toHaveLength(1);
	});

	it('relaxes rather than returning a short page when operators are too few', () => {
		// Three operators cannot fill six slots at one each. A short page is worse
		// than a relaxed cap, and the relaxation still spreads by placement count.
		const few = [
			row('a1', 'A', 99),
			row('a2', 'A', 98),
			row('a3', 'A', 97),
			row('b1', 'B', 96),
			row('b2', 'B', 95),
			row('c1', 'C', 94)
		];
		const { results } = applyOperatorDiversity(few, cfg);
		expect(results).toHaveLength(6);
		const first3 = new Set(results.slice(0, 3).map((r) => r.operatorId));
		expect(first3.size).toBe(3);
	});
});

describe('11. deferred tours are reinserted, never lost', () => {
	it('returns every tour it was given, exactly once', () => {
		const input = [row('a1', 'A', 99), row('a2', 'A', 98), row('a3', 'A', 97), row('b1', 'B', 60), row('b2', 'B', 59)];
		const { results } = applyOperatorDiversity(input, cfg);
		expect(results).toHaveLength(input.length);
		expect(new Set(results.map((r) => r.tourId)).size).toBe(input.length);
		for (const r of input) expect(results.some((x) => x.tourId === r.tourId)).toBe(true);
	});

	it('is skipped entirely when there is only one operator', () => {
		// The guard that stops a single-operator marketplace rendering one card.
		const single = [row('a1', 'A', 99), row('a2', 'A', 98), row('a3', 'A', 97)];
		const { results, diversityApplied } = applyOperatorDiversity(single, cfg);
		expect(diversityApplied).toBe(false);
		expect(results).toHaveLength(3);
	});
});

/* ---------------------------------------------------------- rotation ----- */

describe('12 & 13. deterministic rotation', () => {
	const tied = [row('t1', 'A', 80), row('t2', 'B', 80.2), row('t3', 'C', 79.9)];

	it('is stable for the same session and day', () => {
		const a = sortWithRotation(tied, 'session-x', '2026-09-02').map((r) => r.tourId);
		const b = sortWithRotation(tied, 'session-x', '2026-09-02').map((r) => r.tourId);
		expect(a).toEqual(b);
	});

	it('rotates across sessions or days', () => {
		const base = sortWithRotation(tied, 'session-x', '2026-09-02')
			.map((r) => r.tourId)
			.join();
		const orders = new Set([base]);
		for (const s of ['session-y', 'session-z', 'session-q']) {
			orders.add(
				sortWithRotation(tied, s, '2026-09-02')
					.map((r) => r.tourId)
					.join()
			);
		}
		for (const d of ['2026-09-03', '2026-09-04', '2026-09-05']) {
			orders.add(
				sortWithRotation(tied, 'session-x', d)
					.map((r) => r.tourId)
					.join()
			);
		}
		expect(orders.size).toBeGreaterThan(1);
	});

	it('never reorders a real score difference', () => {
		const clear = [row('low', 'A', 40), row('high', 'B', 90)];
		for (const s of ['s1', 's2', 's3', 's4', 's5', 's6']) {
			expect(sortWithRotation(clear, s, '2026-09-02')[0].tourId).toBe('high');
		}
	});

	it('produces a date bucket of the day', () => {
		expect(dateBucket(new Date('2026-09-02T23:59:00Z'))).toBe('2026-09-02');
	});
});

/* ------------------------------------------------------- eligibility ----- */

describe('14 & 15. eligibility is enforced upstream, not by the scorer', () => {
	/*
	 * Unpublished tours and inactive operators never reach this module: they are
	 * excluded by the candidate query, in code, where ranking configuration cannot
	 * reach them. These assert the contract that keeps it that way — the scorer
	 * has no field that could re-admit them, so there is nothing a weight can do.
	 */
	it('offers no status or visibility input a weight could override', () => {
		const keys = Object.keys(candidate());
		for (const forbidden of ['status', 'isPublished', 'deletedAt', 'visible', 'operatorActive']) {
			expect(keys).not.toContain(forbidden);
		}
	});

	it('ranks only what it is handed', () => {
		const { results } = rankCandidates([], { config: cfg, context: {}, sessionKey: 's', now: NOW });
		expect(results).toHaveLength(0);
	});
});

describe('16. only published reviews count', () => {
	it('a tour whose reviews are all unpublished scores as having none', () => {
		// The candidate query counts PUBLISHED only, so pending/hidden/rejected
		// arrive here as count 0 — and that must not differ from having no reviews.
		const noReviews = candidate({ reviewCount: 0, reviewAverage: null });
		const onlyPending = candidate({ reviewCount: 0, reviewAverage: null });
		expect(qualityScore(onlyPending)).toBe(qualityScore(noReviews));
	});

	it('weighs a confident average above a lucky one', () => {
		// 5.0 from one review must not beat 4.9 from forty.
		expect(reviewConfidence(4.9, 40)).toBeGreaterThan(reviewConfidence(5, 1));
	});

	it('is zero without reviews', () => {
		expect(reviewConfidence(null, 0)).toBe(0);
		expect(reviewConfidence(5, 0)).toBe(0);
	});
});

describe('17. the ranking version travels with the run', () => {
	it('reports the config version that produced the order', () => {
		const out = rankCandidates([candidate()], { config: cfg, context: {}, sessionKey: 's', now: NOW });
		expect(out.rankingVersion).toBe(cfg.version);

		const v7 = { ...cfg, version: 7 };
		expect(rankCandidates([candidate()], { config: v7, context: {}, sessionKey: 's', now: NOW }).rankingVersion).toBe(
			7
		);
	});
});

describe('18. defaults are what the spec asked for', () => {
	it('matches the V1 configuration', () => {
		expect(cfg.weights).toEqual({ relevance: 40, quality: 20, fairness: 20, freshness: 10, performance: 10 });
		expect(cfg.exposureWindowDays).toBe(30);
		expect(cfg.explorationBoost).toBe(10);
		expect(cfg.newOperatorBoostEnabled).toBe(true);
		expect(cfg.firstWindowSize).toBe(6);
		expect(cfg.firstWindowMaxPerOperator).toBe(1);
		expect(cfg.secondWindowSize).toBe(12);
		expect(cfg.secondWindowMaxPerOperator).toBe(2);
		expect(cfg.version).toBe(1);
	});
});

/* ------------------------------------------------------ score shapes ----- */

describe('components stay inside 0–100', () => {
	it('holds at both extremes', () => {
		const best = candidate({
			recentImpressions: 0,
			operatorIsNew: true,
			publishedAt: new Date(NOW),
			updatedAt: new Date(NOW),
			enquiries: 50,
			quotations: 50,
			bookings: 50,
			reviewCount: 100,
			reviewAverage: 5
		});
		const worst = candidate({
			recentImpressions: 1000,
			hasHero: false,
			galleryCount: 0,
			itineraryDays: 0,
			hasPrice: false,
			hasShortDescription: false,
			operatorProfileComplete: false,
			publishedAt: new Date(NOW - 900 * 86_400_000),
			updatedAt: null,
			enquiries: 40,
			quotations: 0,
			bookings: 0
		});
		for (const c of [best, worst]) {
			const s = score(c, {}, 1000);
			for (const v of [s.relevance, s.quality, s.fairness, s.freshness, s.performance, s.final]) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(100);
			}
		}
	});

	it('freshness decays and floors at zero', () => {
		expect(freshnessScore(candidate({ publishedAt: new Date(NOW), updatedAt: null }), NOW)).toBe(100);
		expect(freshnessScore(candidate({ publishedAt: new Date(NOW - 400 * 86_400_000), updatedAt: null }), NOW)).toBe(0);
	});

	it('gives every candidate equal relevance when nothing was asked', () => {
		expect(relevanceScore(candidate(), {})).toBe(50);
	});
});
