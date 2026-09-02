// Operator verification: who is waiting, and who is already carrying the badge.
//
// WHY THIS PAGE EXISTS
//
// Verification is the marketplace's own claim about a company — it renders as a
// badge on the public storefront, so it is the platform vouching, not a form the
// operator fills in. Until now the only way to make that call was to open one
// operator's detail page and find a button, which meant nobody could answer the
// question that actually matters: WHO IS WAITING?
//
// Nothing in the listing lifecycle blocks on verification (assertPublishable
// checks ten CONTENT fields and not one thing about the company — see
// src/lib/server/tours.ts:1128). That is a deliberate product choice, not a bug:
// a new operator can list and sell while the platform does its checks. It only
// works if the queue is visible, which is what this page is for. The listing
// counts below are the cost of leaving someone in it — an unverified operator
// with live listings is already trading on our front page.
//
// The route is super-admin guarded by src/routes/admin/+layout.server.ts.
import { fail } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { db, schema } from '$lib/server/db';
import { toAppError } from '$lib/server/errors';
import type { Actions, PageServerLoad } from './$types';

/**
 * The three states an operator can be in, as a queue rather than a flag.
 *
 * `missing` is not a filter over profiles — it is the absence of one. A tenant
 * with listings and no operator_profiles row cannot be verified at all: the
 * verify control on the operator's own page is wrapped in {#if data.operator},
 * so for exactly the operators who need it most the button does not render.
 * It is a real failure mode (a bulk import that writes tour rows directly skips
 * ensureOperatorProfile), so it gets a tab instead of being invisible.
 */
const TABS = {
	awaiting: { label: 'Awaiting verification' },
	verified: { label: 'Verified' },
	missing: { label: 'No public profile' }
} as const;

type TabKey = keyof typeof TABS;

/** Filled-in fields that make a profile something a human could actually check. */
const COMPLETENESS_FIELDS = 5;

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('tab') ?? '';
	const tab: TabKey = requested in TABS ? (requested as TabKey) : 'awaiting';
	const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';

	// Listing counts are correlated subqueries rather than joins: a tenant has many
	// tours, and joining them would multiply the row per listing and break every
	// count on the page.
	const published = sql<number>`(select count(*) from tours t where t.tenant_id = ${schema.tenants.id} and t.status = 'PUBLISHED' and t.deleted_at is null)::int`;
	const pending = sql<number>`(select count(*) from tours t where t.tenant_id = ${schema.tenants.id} and t.status in ('SUBMITTED','IN_REVIEW') and t.deleted_at is null)::int`;
	const listings = sql<number>`(select count(*) from tours t where t.tenant_id = ${schema.tenants.id} and t.deleted_at is null)::int`;

	const rows = await db()
		.select({
			tenantId: schema.tenants.id,
			tenantName: schema.tenants.name,
			tenantSlug: schema.tenants.slug,
			accountStatus: schema.tenants.status,
			createdAt: schema.tenants.createdAt,
			profileId: schema.operatorProfiles.id,
			displayName: schema.operatorProfiles.displayName,
			profileSlug: schema.operatorProfiles.slug,
			isVerified: schema.operatorProfiles.isVerified,
			verifiedAt: schema.operatorProfiles.verifiedAt,
			isActive: schema.operatorProfiles.isActive,
			about: schema.operatorProfiles.about,
			logoMediaId: schema.operatorProfiles.logoMediaId,
			location: schema.operatorProfiles.location,
			websiteUrl: schema.operatorProfiles.websiteUrl,
			publicEmail: schema.operatorProfiles.publicEmail,
			publicPhone: schema.operatorProfiles.publicPhone,
			specialties: schema.operatorProfiles.specialties,
			published,
			pending,
			listings,
			// The OTHER verification. Named `ownerEmailConfirmed` and never "verified",
			// because the operators list already shows this under the word "unverified"
			// and an admin reading that column has no way to tell it apart from the
			// marketplace badge. Two different claims must not share one word.
			ownerEmail: sql<string | null>`(
				select u.email from tenant_memberships tm join users u on u.id = tm.user_id
				where tm.tenant_id = ${schema.tenants.id} and tm.role = 'OWNER'
				order by tm.created_at limit 1
			)`,
			ownerEmailConfirmed: sql<boolean | null>`(
				select u.email_verified_at is not null from tenant_memberships tm join users u on u.id = tm.user_id
				where tm.tenant_id = ${schema.tenants.id} and tm.role = 'OWNER'
				order by tm.created_at limit 1
			)`
		})
		.from(schema.tenants)
		.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.tenants.id))
		.where(isNull(schema.tenants.deletedAt));

	const shaped = rows.map((r) => {
		const filled = [
			Boolean(r.about?.trim()),
			Boolean(r.logoMediaId),
			Boolean(r.location?.trim()),
			Boolean(r.websiteUrl?.trim() || r.publicEmail?.trim() || r.publicPhone?.trim()),
			Array.isArray(r.specialties) && r.specialties.length > 0
		];
		return {
			...r,
			name: r.displayName || r.tenantName,
			// What a reviewer would have to read before vouching for this company. Shown
			// as a fraction rather than a percentage: five named things beats "60%".
			completeness: filled.filter(Boolean).length,
			completenessTotal: COMPLETENESS_FIELDS,
			missingProfileFields: [
				!filled[0] && 'a description',
				!filled[1] && 'a logo',
				!filled[2] && 'a location',
				!filled[3] && 'a way to contact them',
				!filled[4] && 'what they specialise in'
			].filter((v): v is string => typeof v === 'string')
		};
	});

	const inTab = (r: (typeof shaped)[number]) =>
		tab === 'missing'
			? !r.profileId && r.listings > 0
			: tab === 'verified'
				? Boolean(r.profileId) && r.isVerified
				: Boolean(r.profileId) && !r.isVerified;

	const matches = (r: (typeof shaped)[number]) =>
		!q ||
		r.name.toLowerCase().includes(q) ||
		r.tenantSlug.toLowerCase().includes(q) ||
		(r.ownerEmail ?? '').toLowerCase().includes(q);

	const list = shaped
		.filter(inTab)
		.filter(matches)
		// Riskiest first, and "risk" here has a precise meaning: an operator with
		// listings already PUBLISHED is trading on the marketplace's front page with no
		// badge behind them, so they are the ones a delay actually costs something.
		// Then by how much work is queued behind them, then longest-waiting.
		.sort(
			(a, b) =>
				b.published - a.published ||
				b.pending - a.pending ||
				new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
		);

	const counts = {
		awaiting: shaped.filter((r) => r.profileId && !r.isVerified).length,
		verified: shaped.filter((r) => r.profileId && r.isVerified).length,
		missing: shaped.filter((r) => !r.profileId && r.listings > 0).length
	};

	return {
		rows: list,
		tab,
		q,
		tabs: (Object.keys(TABS) as TabKey[]).map((key) => ({ key, label: TABS[key].label, count: counts[key] })),
		// Headline for the page: how much is already public without a badge behind it.
		liveWithoutBadge: shaped.filter((r) => !r.isVerified).reduce((n, r) => n + r.published, 0)
	};
};

/**
 * Grant or withdraw the badge.
 *
 * The same write as the operator's own admin page (src/routes/admin/tenants/[id]),
 * offered here too because a queue you cannot act on is a report. It records WHO
 * signed it off and WHEN, and clears both on withdrawal — a stale "verified on"
 * date under an unverified operator is worse than no date at all.
 *
 * Never a default and never bulk: verification is a claim about one company that
 * somebody has actually checked, and a badge handed to fifteen operators in one
 * click is not a signal. That is a deliberate refusal, not a missing feature.
 */
export const actions: Actions = {
	verify: async ({ locals, request }) => {
		const data = await request.formData();
		const tenantId = String(data.get('tenantId') ?? '');
		const verified = String(data.get('verified') ?? '') === 'true';
		if (!tenantId) return fail(400, { message: 'Which operator?' });

		try {
			const [profile] = await db()
				.update(schema.operatorProfiles)
				.set({
					isVerified: verified,
					verifiedAt: verified ? new Date() : null,
					verifiedBy: verified ? (locals.user?.id ?? null) : null,
					updatedAt: new Date()
				})
				.where(eq(schema.operatorProfiles.tenantId, tenantId))
				.returning({ id: schema.operatorProfiles.id, displayName: schema.operatorProfiles.displayName });

			if (!profile) {
				return fail(404, {
					message:
						'This operator has no public profile yet, so there is nothing to verify. They get one when they publish a listing or open their storefront settings.'
				});
			}

			await audit(
				tenantId,
				'tenant.updated',
				{ type: 'user', userId: locals.user!.id },
				{ type: 'tenant', id: tenantId },
				{ action: verified ? 'operator_verified' : 'operator_verification_withdrawn' }
			);
			return { success: true, verified, name: profile.displayName };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
