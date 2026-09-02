/**
 * Discovery ranking, as arithmetic. No database, no I/O, no framework.
 *
 * Everything here is a pure function over data somebody else fetched, which is
 * what lets the whole ranking model be tested without a database — and this
 * project's DB-backed tests skip silently without TEST_DATABASE_URL, so a
 * ranking whose only tests were integration tests would be a ranking nobody had
 * actually verified.
 *
 * THE MODEL
 *
 *   final = relevance·Wr + quality·Wq + fairness·Wf + freshness·Wn + performance·Wp
 *           ────────────────────────────────────────────────────────────────────
 *                                    Wr+Wq+Wf+Wn+Wp
 *
 * Every component is normalised to 0–100 before weighting, so the weights mean
 * what they say: relevance at 40 contributes at most 40 points of the final 100.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * No operator overrides, no boost fields, no "promote tenant X". A neutral
 * organic ranking is only neutral if there is nowhere to put a thumb.
 */

/* ------------------------------------------------------------- config ----- */

export type DiscoveryWeights = {
	relevance: number;
	quality: number;
	fairness: number;
	freshness: number;
	performance: number;
};

export type DiscoveryConfig = {
	version: number;
	weights: DiscoveryWeights;
	/** How far back exposure is counted. Recent, never lifetime. */
	exposureWindowDays: number;
	/** Maximum fairness points an under-exposed operator can gain. */
	explorationBoost: number;
	newOperatorBoostEnabled: boolean;
	firstWindowSize: number;
	firstWindowMaxPerOperator: number;
	secondWindowSize: number;
	secondWindowMaxPerOperator: number;
};

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
	version: 1,
	weights: { relevance: 40, quality: 20, fairness: 20, freshness: 10, performance: 10 },
	exposureWindowDays: 30,
	explorationBoost: 10,
	newOperatorBoostEnabled: true,
	firstWindowSize: 6,
	firstWindowMaxPerOperator: 1,
	secondWindowSize: 12,
	secondWindowMaxPerOperator: 2
};

export const WEIGHT_TOTAL = 100;

/**
 * Weights must total exactly 100.
 *
 * Not pedantry: the final score divides by the total, so weights summing to 80
 * would silently rescale every score and make two configurations impossible to
 * compare. Rejecting at the door is cheaper than explaining the drift later.
 */
export function validateWeights(w: DiscoveryWeights): { ok: true } | { ok: false; message: string } {
	const values = [w.relevance, w.quality, w.fairness, w.freshness, w.performance];
	if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
		return { ok: false, message: 'Each weight must be a number between 0 and 100.' };
	}
	const total = values.reduce((a, b) => a + b, 0);
	if (total !== WEIGHT_TOTAL) {
		return { ok: false, message: `Weights must total ${WEIGHT_TOTAL}. They currently total ${total}.` };
	}
	return { ok: true };
}

/* ------------------------------------------------------------ inputs ----- */

/** What the traveller or the page actually asked for. Absent means "no opinion". */
export type DiscoveryContextInput = {
	countrySlug?: string | null;
	destinationSlug?: string | null;
	categorySlug?: string | null;
	styleSlugs?: string[];
	activitySlugs?: string[];
	minDays?: number | null;
	maxDays?: number | null;
	priceMin?: number | null;
	priceMax?: number | null;
	groupType?: string | null;
};

/** One candidate, already fetched and already proven eligible. */
export type Candidate = {
	tourId: string;
	operatorId: string;
	countrySlug: string | null;
	destinationSlugs: string[];
	categorySlugs: string[];
	styleSlugs: string[];
	activitySlugs: string[];
	durationDays: number | null;
	priceFrom: number | null;
	groupType: string | null;

	/* quality inputs */
	hasHero: boolean;
	galleryCount: number;
	itineraryDays: number;
	hasPrice: boolean;
	hasShortDescription: boolean;
	operatorProfileComplete: boolean;
	reviewCount: number;
	reviewAverage: number | null;

	/* freshness */
	publishedAt: Date | string | null;
	updatedAt: Date | string | null;

	/* fairness — impressions inside the configured window */
	recentImpressions: number;
	/** True when the operator has no exposure history worth speaking of. */
	operatorIsNew: boolean;

	/* performance — absent is neutral, never a penalty */
	enquiries: number;
	quotations: number;
	bookings: number;
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));
const asTime = (v: Date | string | null | undefined): number | null => {
	if (!v) return null;
	const t = new Date(v).getTime();
	return Number.isFinite(t) ? t : null;
};

/* --------------------------------------------------------- relevance ----- */

/**
 * How well this tour answers what was actually asked.
 *
 * Structured matches only — the taxonomy tables exist precisely so discovery
 * never has to guess from text. A page that asked for nothing (the homepage)
 * gives every candidate the same neutral relevance, which is correct: with no
 * question asked, relevance cannot separate anyone, and the other components
 * decide the order.
 *
 * Scored as a proportion of the criteria the caller actually supplied, so
 * asking one question and matching it is as relevant as asking four and
 * matching four. Anything that fails a supplied criterion has already been
 * excluded by eligibility, so this measures depth of match, not pass/fail.
 */
export function relevanceScore(c: Candidate, ctx: DiscoveryContextInput): number {
	const parts: number[] = [];

	if (ctx.countrySlug) parts.push(c.countrySlug === ctx.countrySlug ? 100 : 0);
	if (ctx.destinationSlug) parts.push(c.destinationSlugs.includes(ctx.destinationSlug) ? 100 : 0);
	if (ctx.categorySlug) parts.push(c.categorySlugs.includes(ctx.categorySlug) ? 100 : 0);

	if (ctx.styleSlugs?.length) {
		const hit = ctx.styleSlugs.filter((s) => c.styleSlugs.includes(s)).length;
		parts.push((hit / ctx.styleSlugs.length) * 100);
	}
	if (ctx.activitySlugs?.length) {
		const hit = ctx.activitySlugs.filter((a) => c.activitySlugs.includes(a)).length;
		parts.push((hit / ctx.activitySlugs.length) * 100);
	}

	if (ctx.minDays != null || ctx.maxDays != null) {
		const d = c.durationDays;
		const within = d != null && (ctx.minDays == null || d >= ctx.minDays) && (ctx.maxDays == null || d <= ctx.maxDays);
		parts.push(within ? 100 : 0);
	}
	if (ctx.priceMin != null || ctx.priceMax != null) {
		const p = c.priceFrom;
		const within =
			p != null && (ctx.priceMin == null || p >= ctx.priceMin) && (ctx.priceMax == null || p <= ctx.priceMax);
		parts.push(within ? 100 : 0);
	}
	if (ctx.groupType) parts.push(c.groupType === ctx.groupType ? 100 : 0);

	// Nothing was asked. Everyone is equally relevant, which is the honest answer.
	if (!parts.length) return 50;
	return clamp(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/* ----------------------------------------------------------- quality ----- */

/**
 * How complete and trustworthy the listing is.
 *
 * Completeness is most of it, because completeness is a fact the software can
 * check. Reviews contribute only the part they have earned — see
 * `reviewConfidence` — and a tour with none is not punished for it: it scores
 * the completeness it has, out of the completeness available. Requiring reviews
 * to be discoverable would make a new operator permanently invisible, which is
 * the thing this engine exists to prevent.
 */
export function qualityScore(c: Candidate): number {
	// 70 points of listing completeness anyone can reach on day one.
	let completeness = 0;
	if (c.hasHero) completeness += 20;
	if (c.galleryCount >= 3) completeness += 12;
	else if (c.galleryCount > 0) completeness += 6;
	if (c.itineraryDays >= 3) completeness += 16;
	else if (c.itineraryDays > 0) completeness += 8;
	if (c.hasPrice) completeness += 12;
	if (c.hasShortDescription) completeness += 5;
	if (c.operatorProfileComplete) completeness += 5;

	// 30 points reviews can add once they exist. Absent reviews add nothing;
	// they do not subtract, and the 70 above remain fully reachable.
	const review = reviewConfidence(c.reviewAverage, c.reviewCount) * 30;

	return clamp(completeness + review);
}

/**
 * A rating worth what the evidence supports, in 0–1.
 *
 * A bare average makes 5.0 from one review beat 4.9 from forty, which is
 * backwards — the second is the stronger claim. This shrinks the average toward
 * the midpoint by how little evidence there is (a Bayesian prior, m = 5 reviews),
 * so confidence has to be earned before a high rating counts for full value.
 */
export function reviewConfidence(average: number | null, count: number): number {
	if (!count || average == null) return 0;
	const PRIOR_MEAN = 3.5;
	const PRIOR_WEIGHT = 5;
	const adjusted = (average * count + PRIOR_MEAN * PRIOR_WEIGHT) / (count + PRIOR_WEIGHT);
	// 1 star is the floor of the scale, so map 1–5 onto 0–1 rather than 0–5.
	return clamp((adjusted - 1) / 4, 0, 1);
}

/* ---------------------------------------------------------- fairness ----- */

/**
 * Less recent exposure earns a modest lift; heavy exposure gives one up.
 *
 * Measured against the most-exposed candidate in the same run, so this is always
 * relative to the page being built rather than to an absolute impression count
 * that would mean different things on a busy day and a quiet one.
 *
 * Capped by `explorationBoost` on purpose. Fairness must never be able to lift
 * an irrelevant listing over a relevant one — with the default weights, the most
 * fairness can move a tour is 20 points of the final 100, and a relevance gap is
 * usually larger than that.
 */
export function fairnessScore(c: Candidate, maxImpressions: number, cfg: DiscoveryConfig): number {
	// Nobody has been seen yet: everyone is equally under-exposed, so fairness
	// separates no one. Neutral, not maximal.
	if (maxImpressions <= 0) return 50;

	/*
	 * Headroom is reserved for the boost rather than added on top.
	 *
	 * Added on top it was invisible precisely where it mattered: an unseen
	 * operator already scores 100 from exposure alone, so the boost clamped away
	 * and a brand-new operator ranked identically to an established one having a
	 * quiet month. Scaling the exposure part into (100 − boost) leaves exactly
	 * `explorationBoost` points that only a new operator can reach.
	 */
	const boost = cfg.newOperatorBoostEnabled ? cfg.explorationBoost : 0;
	const share = clamp(c.recentImpressions / maxImpressions, 0, 1);
	const base = (1 - share) * (100 - boost);
	return clamp(base + (cfg.newOperatorBoostEnabled && c.operatorIsNew ? boost : 0));
}

/* --------------------------------------------------------- freshness ----- */

/**
 * Recently published or genuinely updated listings rotate upward, gently.
 *
 * Publication is what counts, with an update able to refresh it — but only to
 * the same ceiling, so re-saving a tour cannot beat actually publishing one.
 * Decays to zero over 180 days rather than falling off a cliff.
 */
export function freshnessScore(c: Candidate, now: number = Date.now()): number {
	const published = asTime(c.publishedAt);
	const updated = asTime(c.updatedAt);
	const newest = Math.max(published ?? 0, updated ?? 0);
	if (!newest) return 0;

	const HORIZON_DAYS = 180;
	const ageDays = (now - newest) / 86_400_000;
	if (ageDays <= 0) return 100;
	return clamp(100 * (1 - ageDays / HORIZON_DAYS));
}

/* ------------------------------------------------------- performance ----- */

/**
 * A weak signal, and neutral where there is no evidence.
 *
 * An operator with no history scores 50 — the same as an average one — because
 * "we have never seen you convert" is not evidence of failing to convert, and
 * treating it as such would lock a new operator out on their first day.
 *
 * MIN_EVIDENCE guards the small-numbers trap: one enquiry that became one
 * booking is not a 100% conversion rate worth ranking on.
 */
export function performanceScore(c: Candidate): number {
	const MIN_EVIDENCE = 5;
	if (c.enquiries < MIN_EVIDENCE) return 50;

	const toQuote = clamp(c.quotations / c.enquiries, 0, 1);
	const toBooking = clamp(c.bookings / Math.max(1, c.quotations), 0, 1);
	// Booking is the outcome that matters, so it carries the larger share.
	return clamp((toQuote * 0.4 + toBooking * 0.6) * 100);
}

/* ------------------------------------------------------------- final ----- */

export type ScoreBreakdown = {
	tourId: string;
	operatorId: string;
	relevance: number;
	quality: number;
	fairness: number;
	freshness: number;
	performance: number;
	final: number;
};

export function scoreCandidate(
	c: Candidate,
	ctx: DiscoveryContextInput,
	cfg: DiscoveryConfig,
	maxImpressions: number,
	now: number = Date.now()
): ScoreBreakdown {
	const relevance = relevanceScore(c, ctx);
	const quality = qualityScore(c);
	const fairness = fairnessScore(c, maxImpressions, cfg);
	const freshness = freshnessScore(c, now);
	const performance = performanceScore(c);
	const w = cfg.weights;

	const total = w.relevance + w.quality + w.fairness + w.freshness + w.performance;
	const final =
		total <= 0
			? 0
			: (relevance * w.relevance +
					quality * w.quality +
					fairness * w.fairness +
					freshness * w.freshness +
					performance * w.performance) /
				total;

	return {
		tourId: c.tourId,
		operatorId: c.operatorId,
		relevance: round2(relevance),
		quality: round2(quality),
		fairness: round2(fairness),
		freshness: round2(freshness),
		performance: round2(performance),
		final: round2(final)
	};
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------------------------------------------------------- rotation ----- */

/**
 * A stable shuffle among scores that are effectively tied.
 *
 * Not randomness: the same session on the same day must see the same order, or
 * paging through results shows duplicates and misses. The jitter is derived from
 * (sessionKey, date bucket, tourId), so it is fixed for a visit and different
 * tomorrow.
 *
 * ROTATION_BAND is the whole safeguard. Jitter can only reorder tours already
 * within a point of each other, so it can never overturn a real score difference.
 */
export const ROTATION_BAND = 1.0;

export function rotationJitter(tourId: string, sessionKey: string, dateBucket: string): number {
	const seed = `${sessionKey}|${dateBucket}|${tourId}`;
	// FNV-1a: tiny, dependency-free, and good enough to decorrelate ids.
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return ((h >>> 0) % 1000) / 1000;
}

/** Today, as the bucket rotation turns on. */
export const dateBucket = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export function sortWithRotation(
	scored: ScoreBreakdown[],
	sessionKey: string,
	bucket: string = dateBucket()
): ScoreBreakdown[] {
	return [...scored].sort((a, b) => {
		const gap = b.final - a.final;
		if (Math.abs(gap) > ROTATION_BAND) return gap;
		const ja = rotationJitter(a.tourId, sessionKey, bucket);
		const jb = rotationJitter(b.tourId, sessionKey, bucket);
		if (ja !== jb) return jb - ja;
		// Last resort so the order is total and never depends on input order.
		return a.tourId.localeCompare(b.tourId);
	});
}

/* --------------------------------------------------------- diversity ----- */

/**
 * Stop one operator owning the first page.
 *
 * A tour over its operator's cap for the current window is DEFERRED, not
 * dropped — held back and reinserted at the first position where its operator
 * is under cap again. Discarding it would mean a strong listing disappearing
 * because of who published it.
 *
 * GUARDED: with fewer than two operators in the candidate set this returns the
 * list untouched. On a marketplace with one operator, "max 1 per operator in the
 * first 6" yields a page of ONE tour — the rule would be enforcing diversity
 * that cannot exist, and the reader would just see an empty catalogue.
 */
export function applyOperatorDiversity(
	ranked: ScoreBreakdown[],
	cfg: DiscoveryConfig
): { results: ScoreBreakdown[]; diversityApplied: boolean } {
	const operators = new Set(ranked.map((r) => r.operatorId));
	if (operators.size < 2) return { results: ranked, diversityApplied: false };

	const capAt = (position: number): number | null => {
		if (position < cfg.firstWindowSize) return cfg.firstWindowMaxPerOperator;
		if (position < cfg.secondWindowSize) return cfg.secondWindowMaxPerOperator;
		return null; // beyond the protected windows, normal ranking resumes
	};

	const results: ScoreBreakdown[] = [];
	const used = new Map<string, number>();
	const deferred: ScoreBreakdown[] = [];
	const queue = [...ranked];

	while (queue.length || deferred.length) {
		const cap = capAt(results.length);

		// A deferred tour goes back in as soon as its operator is under cap.
		const readyIndex = deferred.findIndex((d) => cap == null || (used.get(d.operatorId) ?? 0) < cap);
		if (readyIndex > -1) {
			const [pick] = deferred.splice(readyIndex, 1);
			results.push(pick);
			used.set(pick.operatorId, (used.get(pick.operatorId) ?? 0) + 1);
			continue;
		}

		if (!queue.length) {
			/*
			 * The cap cannot be met and there is nothing else left.
			 *
			 * This happens when the candidate set has fewer distinct operators than
			 * the window has slots — six slots at one each needs six operators. The
			 * choice is a short page or a relaxed cap, and a short page is worse.
			 * Relaxing still spreads: the deferred tour whose operator has been
			 * placed least often goes next, so the backlog of one operator cannot
			 * empty itself into the gap.
			 */
			let bestIndex = 0;
			for (let i = 1; i < deferred.length; i++) {
				const a = used.get(deferred[i].operatorId) ?? 0;
				const b = used.get(deferred[bestIndex].operatorId) ?? 0;
				if (a < b) bestIndex = i;
			}
			const [pick] = deferred.splice(bestIndex, 1);
			results.push(pick);
			used.set(pick.operatorId, (used.get(pick.operatorId) ?? 0) + 1);
			continue;
		}

		const next = queue.shift()!;
		const count = used.get(next.operatorId) ?? 0;
		if (cap != null && count >= cap) {
			deferred.push(next);
			continue;
		}
		results.push(next);
		used.set(next.operatorId, count + 1);
	}

	return { results, diversityApplied: true };
}

/* ------------------------------------------------------------ the run ---- */

export type RankOptions = {
	config: DiscoveryConfig;
	context: DiscoveryContextInput;
	sessionKey: string;
	now?: number;
	bucket?: string;
};

export type RankResult = {
	results: ScoreBreakdown[];
	rankingVersion: number;
	diversityApplied: boolean;
};

/** Score, rotate among ties, then protect the first page. */
export function rankCandidates(candidates: Candidate[], opts: RankOptions): RankResult {
	const maxImpressions = candidates.reduce((m, c) => Math.max(m, c.recentImpressions), 0);
	const scored = candidates.map((c) =>
		scoreCandidate(c, opts.context, opts.config, maxImpressions, opts.now ?? Date.now())
	);
	const rotated = sortWithRotation(scored, opts.sessionKey, opts.bucket ?? dateBucket());
	const { results, diversityApplied } = applyOperatorDiversity(rotated, opts.config);
	return { results, rankingVersion: opts.config.version, diversityApplied };
}
