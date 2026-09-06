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
	booked: number;
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
	booked: number;
	quoteRate: number | null;
	bookingConversion: number | null;
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

async function performanceSummary(
	tenantId: string,
	from: Date | null,
	to: Date | null
): Promise<MarketplacePerformanceSummary> {
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
			count(*) filter (where cohort.converted_booking_id is not null or exists (
				select 1 from bookings b where b.tenant_id = ${tenantId}::uuid
					and b.booking_request_id = cohort.id and b.deleted_at is null
			))::int as booked,
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
	const booked = Number(result.booked ?? 0);
	const median = finite(result.median_response_hours ?? null);
	return {
		tourViews: Number(result.tour_views ?? 0),
		profileViews: Number(result.profile_views ?? 0),
		enquiries,
		quoted,
		booked,
		quoteRate: percentage(quoted, enquiries),
		bookingConversion: percentage(booked, enquiries),
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
	booked: number;
	review_count: number;
	review_average: string | number | null;
};

async function tourPerformance(tenantId: string, from: Date | null, to: Date | null) {
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
				))::int as quoted,
				count(*) filter (where br.converted_booking_id is not null or exists (
					select 1 from bookings b where b.tenant_id = ${tenantId}::uuid
						and b.booking_request_id = br.id and b.deleted_at is null
				))::int as booked
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
			coalesce(enquiry.booked, 0)::int as booked,
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
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		slug: row.slug,
		status: row.status,
		heroUrl: row.hero_url,
		views: Number(row.views),
		enquiries: Number(row.enquiries),
		quoted: Number(row.quoted),
		booked: Number(row.booked),
		quoteRate: percentage(Number(row.quoted), Number(row.enquiries)),
		bookingConversion: percentage(Number(row.booked), Number(row.enquiries)),
		reviews: { count: Number(row.review_count), average: finite(row.review_average) }
	}));
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
	const [current, previous, trend, tours] = await Promise.all([
		performanceSummary(tenantId, range.from, range.to),
		range.previousFrom ? performanceSummary(tenantId, range.previousFrom, range.previousTo) : null,
		performanceTrend(tenantId, chartFrom, range.to, timezone),
		tourPerformance(tenantId, range.from, range.to)
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
		current,
		previous,
		trend,
		tours
	};
}
