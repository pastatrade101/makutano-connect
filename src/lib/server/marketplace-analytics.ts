// Tenant-scoped marketplace performance and privacy-preserving page-view capture.
//
// A public caller never supplies a tenant id. Published tour/operator ownership is
// resolved here from a slug, and every operator report takes its tenant from the
// authenticated portal session before it reaches these queries.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { sha256 } from './encryption';
import { AppError } from './errors';
import { resolveOperatorOwner, resolveTourOwner } from './marketplace';

export const MARKETPLACE_RANGE_KEYS = ['7d', '30d', '90d', 'all'] as const;
export type MarketplaceRangeKey = (typeof MARKETPLACE_RANGE_KEYS)[number];
export type MarketplaceViewKind = 'TOUR' | 'PROFILE';
export type MarketplaceResponseChannel = (typeof schema.marketplaceResponseChannelEnum.enumValues)[number];

const DAY_MS = 86_400_000;
const VIEW_BUCKET_MS = 30 * 60 * 1000;

export function parseMarketplaceRange(value: string | null | undefined): MarketplaceRangeKey {
	return (MARKETPLACE_RANGE_KEYS as readonly string[]).includes(value ?? '') ? (value as MarketplaceRangeKey) : '30d';
}

export function marketplaceRange(key: MarketplaceRangeKey, now = new Date()) {
	if (key === 'all') {
		return { key, label: 'All time', from: null, to: now, previousFrom: null, previousTo: null };
	}
	const days = Number.parseInt(key, 10);
	const from = new Date(now.getTime() - days * DAY_MS);
	return {
		key,
		label: `Last ${days} days`,
		from,
		to: now,
		previousFrom: new Date(from.getTime() - days * DAY_MS),
		previousTo: from
	};
}

export function percentage(numerator: number, denominator: number): number | null {
	return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

/**
 * How many DECIDED enquiries it takes to win one booking.
 *
 * Still-open enquiries are excluded on purpose, and that exclusion is the whole
 * point of the measure. A plain enquiries-per-booking ratio gets worse every
 * time a fresh lead arrives — the operator is punished for demand they have not
 * had a chance to answer yet. Counting only enquiries that reached an outcome
 * keeps the number about how well the listing closes, not how busy this week was.
 *
 * Null until something has been booked: a ratio with no wins in it is a division
 * by zero, not an infinitely bad listing.
 */
export function requestsPerBooking(notBooked: number, booked: number): number | null {
	if (booked <= 0) return null;
	return Math.round(((notBooked + booked) / booked) * 10) / 10;
}

/**
 * A total that knows which currency it is in.
 *
 * There is no FX table in this product, and inventing one to make a single
 * headline figure would put a number on screen that no ledger agrees with. So
 * money is carried per currency and added only within a currency. A tenant
 * quoting in USD and TZS gets two totals, not one wrong one.
 */
export type MoneyTotal = { currency: string; amount: number };

/** One stage of the enquiry funnel: how many, and what they are worth. */
export type FunnelBucket = { count: number; value: MoneyTotal[] };

/**
 * Every enquiry in the window lands in exactly one of these three, so the counts
 * always add back up to the enquiry total. That is what makes the split legible:
 * "still open" is a worklist, "not booked" is what was lost, "booked" is what was won.
 */
export type MarketplaceFunnel = {
	stillOpen: FunnelBucket;
	notBooked: FunnelBucket;
	booked: FunnelBucket;
	requestsPerBooking: number | null;
};

const BUCKETS = ['stillOpen', 'notBooked', 'booked'] as const;
type BucketKey = (typeof BUCKETS)[number];

function emptyFunnel(): MarketplaceFunnel {
	return {
		stillOpen: { count: 0, value: [] },
		notBooked: { count: 0, value: [] },
		booked: { count: 0, value: [] },
		requestsPerBooking: null
	};
}

/**
 * Record one published detail-page view.
 *
 * Only a hash of the opaque marketplace session is stored. A partial unique
 * index makes this idempotent for the same entity, session and 30-minute bucket.
 */
export async function recordMarketplacePageView(input: {
	kind: MarketplaceViewKind;
	slug: string;
	sessionId: string;
}): Promise<{ recorded: boolean }> {
	let tenantId: string;
	let tourId: string | null = null;
	if (input.kind === 'TOUR') {
		const owner = await resolveTourOwner(input.slug);
		if (!owner) throw new AppError('NOT_FOUND', 'Not found.');
		tenantId = owner.tenantId;
		tourId = owner.tourId;
	} else {
		const owner = await resolveOperatorOwner(input.slug);
		if (!owner) throw new AppError('NOT_FOUND', 'Not found.');
		tenantId = owner.tenantId;
	}

	const bucketStart = new Date(Math.floor(Date.now() / VIEW_BUCKET_MS) * VIEW_BUCKET_MS);
	// Include the bucket in the hash so a row can deduplicate refreshes without
	// becoming a long-lived identifier that links one visitor's browsing history.
	const sessionHash = sha256(`marketplace-page-view:${bucketStart.toISOString()}:${input.sessionId}`);
	const rows = await db()
		.insert(schema.marketplacePageViews)
		.values({
			tenantId,
			type: input.kind,
			tourId,
			sessionHash,
			bucketStart
		})
		.onConflictDoNothing()
		.returning({ id: schema.marketplacePageViews.id });
	return { recorded: rows.length > 0 };
}

/** First write wins, so retries or a later channel can never rewrite the response time. */
export async function markMarketplaceEnquiryResponded(
	tenantId: string,
	bookingRequestId: string,
	channel: MarketplaceResponseChannel,
	at = new Date()
): Promise<boolean> {
	const rows = await db()
		.update(schema.bookingRequests)
		.set({ firstRespondedAt: at, firstResponseChannel: channel, updatedAt: at })
		.where(
			and(
				eq(schema.bookingRequests.id, bookingRequestId),
				eq(schema.bookingRequests.tenantId, tenantId),
				eq(schema.bookingRequests.source, 'MARKETPLACE'),
				isNull(schema.bookingRequests.deletedAt),
				isNull(schema.bookingRequests.firstRespondedAt)
			)
		)
		.returning({ id: schema.bookingRequests.id });
	return rows.length > 0;
}

type SummaryRow = {
	tour_views: number;
	profile_views: number;
	enquiries: number;
	quoted: number;
	responded: number;
	unanswered: number;
	median_response_hours: string | number | null;
	review_average: string | number | null;
	review_count: number;
	new_reviews: number;
	tracking_since: Date | string | null;
};

export type MarketplacePerformanceSummary = {
	tourViews: number;
	profileViews: number;
	enquiries: number;
	quoted: number;
	/** Both of these come from `funnel.booked`, never from a second definition. */
	booked: number;
	quoteRate: number | null;
	bookingConversion: number | null;
	funnel: MarketplaceFunnel;
	responded: number;
	unanswered: number;
	medianResponseHours: number | null;
	reviews: { average: number | null; count: number; new: number };
	trackingSince: string | null;
};

function iso(value: Date | string | null): string | null {
	return value ? new Date(value).toISOString() : null;
}

function finite(value: string | number | null): number | null {
	if (value === null) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

/** Everything about the window that is not the won/lost/open split. */
type SummaryCore = Omit<MarketplacePerformanceSummary, 'booked' | 'bookingConversion' | 'funnel'>;

async function performanceSummary(tenantId: string, from: Date | null, to: Date | null): Promise<SummaryCore> {
	const [row] = (await db().execute<SummaryRow>(sql`
		with cohort as (
			select br.*
			from booking_requests br
			where br.tenant_id = ${tenantId}::uuid
				and br.source = 'MARKETPLACE'
				and br.deleted_at is null
				and br.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
				and br.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)
		)
		select
			(select count(*)::int from marketplace_page_views v
				where v.tenant_id = ${tenantId}::uuid and v.type = 'TOUR'
					and v.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
					and v.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)) as tour_views,
			(select count(*)::int from marketplace_page_views v
				where v.tenant_id = ${tenantId}::uuid and v.type = 'PROFILE'
					and v.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
					and v.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)) as profile_views,
			count(*)::int as enquiries,
			count(*) filter (where exists (
				select 1 from quotations q where q.tenant_id = ${tenantId}::uuid
					and q.booking_request_id = cohort.id and q.deleted_at is null and q.sent_at is not null
			))::int as quoted,
			count(*) filter (where first_responded_at is not null)::int as responded,
			count(*) filter (where first_responded_at is null)::int as unanswered,
			percentile_cont(0.5) within group (
				order by extract(epoch from (first_responded_at - created_at)) / 3600
			) filter (where first_responded_at is not null) as median_response_hours,
			(select round(avg(r.rating)::numeric, 1) from reviews r
				where r.tenant_id = ${tenantId}::uuid and r.status = 'PUBLISHED') as review_average,
			(select count(*)::int from reviews r
				where r.tenant_id = ${tenantId}::uuid and r.status = 'PUBLISHED') as review_count,
			(select count(*)::int from reviews r
				where r.tenant_id = ${tenantId}::uuid and r.status = 'PUBLISHED'
					and r.published_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
					and r.published_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)) as new_reviews,
			(select min(v.created_at) from marketplace_page_views v
				where v.tenant_id = ${tenantId}::uuid) as tracking_since
		from cohort
	`)) as unknown as SummaryRow[];

	const result = row ?? ({} as SummaryRow);
	const enquiries = Number(result.enquiries ?? 0);
	const quoted = Number(result.quoted ?? 0);
	const median = finite(result.median_response_hours ?? null);
	return {
		tourViews: Number(result.tour_views ?? 0),
		profileViews: Number(result.profile_views ?? 0),
		enquiries,
		quoted,
		quoteRate: percentage(quoted, enquiries),
		responded: Number(result.responded ?? 0),
		unanswered: Number(result.unanswered ?? 0),
		medianResponseHours: median === null ? null : Math.round(median * 10) / 10,
		reviews: {
			average: finite(result.review_average ?? null),
			count: Number(result.review_count ?? 0),
			new: Number(result.new_reviews ?? 0)
		},
		trackingSince: iso(result.tracking_since ?? null)
	};
}

type TrendRow = {
	day: string;
	tour_views: number;
	profile_views: number;
	enquiries: number;
};

async function performanceTrend(tenantId: string, from: Date, to: Date, timezone: string) {
	const rows = (await db().execute<TrendRow>(sql`
		with days as (
			select generate_series(
				date_trunc('day', ${from.toISOString()}::timestamptz at time zone ${timezone}),
				date_trunc('day', ${to.toISOString()}::timestamptz at time zone ${timezone}),
				interval '1 day'
			)::date as day
		), views as (
			select (v.created_at at time zone ${timezone})::date as day,
				count(*) filter (where v.type = 'TOUR')::int as tour_views,
				count(*) filter (where v.type = 'PROFILE')::int as profile_views
			from marketplace_page_views v
			where v.tenant_id = ${tenantId}::uuid and v.created_at >= ${from.toISOString()}::timestamptz
				and v.created_at < ${to.toISOString()}::timestamptz
			group by 1
		), enquiries as (
			select (br.created_at at time zone ${timezone})::date as day, count(*)::int as enquiries
			from booking_requests br
			where br.tenant_id = ${tenantId}::uuid and br.source = 'MARKETPLACE' and br.deleted_at is null
				and br.created_at >= ${from.toISOString()}::timestamptz and br.created_at < ${to.toISOString()}::timestamptz
			group by 1
		)
		select days.day::text as day,
			coalesce(views.tour_views, 0)::int as tour_views,
			coalesce(views.profile_views, 0)::int as profile_views,
			coalesce(enquiries.enquiries, 0)::int as enquiries
		from days left join views using (day) left join enquiries using (day)
		order by days.day
	`)) as unknown as TrendRow[];
	return rows.map((row) => ({
		day: row.day,
		tourViews: Number(row.tour_views),
		profileViews: Number(row.profile_views),
		enquiries: Number(row.enquiries)
	}));
}

type TourRow = {
	id: string;
	title: string;
	slug: string;
	status: schema.Tour['status'];
	hero_url: string | null;
	views: number;
	enquiries: number;
	quoted: number;
	review_count: number;
	review_average: string | number | null;
};

async function tourPerformance(
	tenantId: string,
	from: Date | null,
	to: Date | null,
	funnelByTour: Map<string, MarketplaceFunnel>
) {
	const rows = (await db().execute<TourRow>(sql`
		with views as (
			select v.tour_id, count(*)::int as views
			from marketplace_page_views v
			where v.tenant_id = ${tenantId}::uuid and v.type = 'TOUR'
				and v.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
				and v.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)
			group by v.tour_id
		), enquiry as (
			select br.tour_id,
				count(*)::int as enquiries,
				count(*) filter (where exists (
					select 1 from quotations q where q.tenant_id = ${tenantId}::uuid
						and q.booking_request_id = br.id and q.deleted_at is null and q.sent_at is not null
				))::int as quoted
			from booking_requests br
			where br.tenant_id = ${tenantId}::uuid and br.source = 'MARKETPLACE'
				and br.deleted_at is null and br.tour_id is not null
				and br.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
				and br.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)
			group by br.tour_id
		), review as (
			select r.tour_id, count(*)::int as review_count, round(avg(r.rating)::numeric, 1) as review_average
			from reviews r
			where r.tenant_id = ${tenantId}::uuid and r.status = 'PUBLISHED' and r.tour_id is not null
			group by r.tour_id
		)
		select t.id, t.title, t.slug, t.status, m.url as hero_url,
			coalesce(views.views, 0)::int as views,
			coalesce(enquiry.enquiries, 0)::int as enquiries,
			coalesce(enquiry.quoted, 0)::int as quoted,
			coalesce(review.review_count, 0)::int as review_count,
			review.review_average
		from tours t
		left join media m on m.id = t.hero_media_id and m.tenant_id = ${tenantId}::uuid
		left join views on views.tour_id = t.id
		left join enquiry on enquiry.tour_id = t.id
		left join review on review.tour_id = t.id
		where t.tenant_id = ${tenantId}::uuid and t.deleted_at is null
		order by coalesce(views.views, 0) desc, coalesce(enquiry.enquiries, 0) desc, t.title asc
	`)) as unknown as TourRow[];
	return rows.map((row) => {
		// A listing with no enquiries in the window has no funnel rows at all,
		// which is a zeroed funnel rather than a missing one.
		const funnel = funnelByTour.get(row.id) ?? emptyFunnel();
		const enquiries = Number(row.enquiries);
		return {
			id: row.id,
			title: row.title,
			slug: row.slug,
			status: row.status,
			heroUrl: row.hero_url,
			views: Number(row.views),
			enquiries,
			quoted: Number(row.quoted),
			booked: funnel.booked.count,
			quoteRate: percentage(Number(row.quoted), enquiries),
			bookingConversion: percentage(funnel.booked.count, enquiries),
			funnel,
			reviews: { count: Number(row.review_count), average: finite(row.review_average) }
		};
	});
}

type FunnelRow = {
	tour_id: string | null;
	bucket: 'STILL_OPEN' | 'NOT_BOOKED' | 'BOOKED';
	currency: string | null;
	requests: number;
	amount: string | number | null;
};

const BUCKET_OF: Record<FunnelRow['bucket'], BucketKey> = {
	STILL_OPEN: 'stillOpen',
	NOT_BOOKED: 'notBooked',
	BOOKED: 'booked'
};

/**
 * Split the enquiry cohort into won / lost / still-deciding, and price each side.
 *
 * This is the one place any of the three counts is computed. The summary and the
 * per-tour table both read it, because two queries that each defined "booked"
 * their own way would eventually disagree on the same screen.
 *
 * Rows for enquiries with no tour are returned with a null tour_id — they belong
 * in the tenant total even though no listing can claim them.
 */
async function funnelBuckets(tenantId: string, from: Date | null, to: Date | null) {
	const rows = (await db().execute<FunnelRow>(sql`
		with cohort as (
			select br.id, br.tour_id, br.status, br.converted_booking_id
			from booking_requests br
			where br.tenant_id = ${tenantId}::uuid
				and br.source = 'MARKETPLACE'
				and br.deleted_at is null
				and br.created_at >= coalesce(${from?.toISOString() ?? null}::timestamptz, '-infinity'::timestamptz)
				and br.created_at < coalesce(${to?.toISOString() ?? null}::timestamptz, 'infinity'::timestamptz)
		), booking as (
			-- distinct on: a request should own one booking, and if data ever says
			-- otherwise the newest is the one that stands rather than both counting.
			select distinct on (b.booking_request_id) b.booking_request_id, b.total, b.currency
			from bookings b
			where b.tenant_id = ${tenantId}::uuid and b.deleted_at is null and b.booking_request_id is not null
			order by b.booking_request_id, b.created_at desc
		), quote as (
			-- The offer that STANDS, not every offer ever made. A re-quoted enquiry
			-- has several sent versions; summing them all would bill the operator's
			-- pipeline twice for one piece of business.
			select distinct on (q.booking_request_id) q.booking_request_id, q.total, q.currency, q.status
			from quotations q
			where q.tenant_id = ${tenantId}::uuid and q.deleted_at is null
				and q.sent_at is not null and q.booking_request_id is not null
			order by q.booking_request_id, q.version desc, q.sent_at desc
		), bucketed as (
			select c.tour_id,
				case
					when c.converted_booking_id is not null or booking.booking_request_id is not null then 'BOOKED'
					-- The enquiry itself was closed off.
					when c.status in ('DECLINED', 'CANCELLED') then 'NOT_BOOKED'
					-- Or the traveller turned down the standing offer, or it lapsed.
					-- declineQuotation does not touch the enquiry's own status, so
					-- reading only the enquiry would leave dead leads in the worklist.
					-- Re-quoting cures it by itself: the newer version becomes the
					-- standing offer and the row moves back to still open.
					when quote.status in ('DECLINED', 'EXPIRED') then 'NOT_BOOKED'
					else 'STILL_OPEN'
				end as bucket,
				-- Won business is worth what was booked; everything else is worth
				-- what was last offered. An enquiry nobody quoted carries no money
				-- at all, and still has to be counted, so this may be null.
				case
					when booking.booking_request_id is not null then booking.currency
					else quote.currency
				end as currency,
				case
					when booking.booking_request_id is not null then booking.total
					else quote.total
				end as amount
			from cohort c
			left join booking on booking.booking_request_id = c.id
			left join quote on quote.booking_request_id = c.id
		)
		select tour_id, bucket, currency, count(*)::int as requests, sum(amount) as amount
		from bucketed
		group by tour_id, bucket, currency
	`)) as unknown as FunnelRow[];

	const tenant = emptyFunnel();
	const byTour = new Map<string, MarketplaceFunnel>();
	const totals = new Map<MarketplaceFunnel, Map<BucketKey, Map<string, number>>>();

	const moneyFor = (funnel: MarketplaceFunnel, bucket: BucketKey) => {
		let perFunnel = totals.get(funnel);
		if (!perFunnel) totals.set(funnel, (perFunnel = new Map()));
		let perBucket = perFunnel.get(bucket);
		if (!perBucket) perFunnel.set(bucket, (perBucket = new Map()));
		return perBucket;
	};

	for (const row of rows) {
		const bucket = BUCKET_OF[row.bucket];
		const requests = Number(row.requests);
		const amount = row.amount === null ? null : Number(row.amount);

		const targets: MarketplaceFunnel[] = [tenant];
		if (row.tour_id) {
			let forTour = byTour.get(row.tour_id);
			if (!forTour) byTour.set(row.tour_id, (forTour = emptyFunnel()));
			targets.push(forTour);
		}
		for (const funnel of targets) {
			funnel[bucket].count += requests;
			if (row.currency && amount !== null && Number.isFinite(amount)) {
				const money = moneyFor(funnel, bucket);
				money.set(row.currency, (money.get(row.currency) ?? 0) + amount);
			}
		}
	}

	for (const funnel of [tenant, ...byTour.values()]) {
		for (const bucket of BUCKETS) {
			const money = totals.get(funnel)?.get(bucket);
			funnel[bucket].value = money
				? [...money].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount)
				: [];
		}
		funnel.requestsPerBooking = requestsPerBooking(funnel.notBooked.count, funnel.booked.count);
	}

	return { tenant, byTour };
}

/** One definition of "booked", carried into the shape the page reads. */
function withFunnel(core: SummaryCore, funnel: MarketplaceFunnel): MarketplacePerformanceSummary {
	return {
		...core,
		booked: funnel.booked.count,
		bookingConversion: percentage(funnel.booked.count, core.enquiries),
		funnel
	};
}

export async function getMarketplacePerformance(
	tenantId: string,
	key: MarketplaceRangeKey,
	timezone = 'UTC',
	now = new Date()
) {
	const range = marketplaceRange(key, now);
	// All-time totals remain all-time; the chart stays bounded and readable.
	const chartFrom = range.from ?? new Date(now.getTime() - 90 * DAY_MS);
	// The tour table needs the funnel before it can finish a row, so it chains off
	// that one promise rather than waiting for a second round trip; everything
	// else still goes out at once.
	const funnelNow = funnelBuckets(tenantId, range.from, range.to);
	const [current, previous, trend, tours, funnel, previousFunnel] = await Promise.all([
		performanceSummary(tenantId, range.from, range.to),
		range.previousFrom ? performanceSummary(tenantId, range.previousFrom, range.previousTo) : null,
		performanceTrend(tenantId, chartFrom, range.to, timezone),
		funnelNow.then((f) => tourPerformance(tenantId, range.from, range.to, f.byTour)),
		funnelNow,
		range.previousFrom ? funnelBuckets(tenantId, range.previousFrom, range.previousTo) : null
	]);
	return {
		range: {
			key: range.key,
			label: range.label,
			from: iso(range.from),
			to: range.to.toISOString(),
			chartFrom: chartFrom.toISOString(),
			chartIsLimited: range.from === null
		},
		current: withFunnel(current, funnel.tenant),
		previous: previous ? withFunnel(previous, previousFunnel?.tenant ?? emptyFunnel()) : null,
		trend,
		tours
	};
}
