// The dashboard's getting-started checklist.
//
// Every item is answered by querying what actually exists — nothing is a stored flag
// someone could tick without doing the work. Items the tenant's plan does not include
// are omitted rather than shown as impossible-to-finish chores.
import { and, eq, sql } from 'drizzle-orm';
import { audit } from './audit';
import { db, schema } from './db';
import { effectiveEntitlements } from './entitlements';
import { log } from './logger';
import { moduleRelevant, normalizeWorkspace } from '$lib/workspace';

export type ChecklistItem = {
	key: string;
	label: string;
	description: string;
	href: string;
	done: boolean;
	/**
	 * What the VIEWER needs to be able to do this, if anything.
	 *
	 * The checklist used to be built from the tenant alone, so it offered a
	 * "Set up" button to whoever was looking regardless of whether that person
	 * could act on it. A Manager (BOOKING_AGENT) has no api_keys:read, and
	 * /app/developers requires it — so the integration row sent them to a page
	 * that refuses them. An item nobody in the room can complete is worse than no
	 * item: it holds the counter below 100% forever with no way to move it.
	 */
	permission?: string;
	/** True when the item is optional and can be declared unnecessary. */
	optional?: boolean;
};

export type OnboardingState = {
	items: ChecklistItem[];
	completed: number;
	total: number;
	/** True once every applicable item is done — the card then congratulates and retires. */
	allDone: boolean;
	dismissed: boolean;
};

async function count(table: string, tenantId: string, extra = ''): Promise<number> {
	const rows = (await db().execute<{ n: number }>(
		sql.raw(`select count(*)::int as n from ${table} where tenant_id = '${tenantId}'::uuid ${extra} limit 1`)
	)) as unknown as Array<{ n: number }>;
	return Number(rows[0]?.n ?? 0);
}

export async function onboardingState(
	tenantId: string,
	viewerPermissions: readonly string[] = []
): Promise<OnboardingState> {
	const tenant = (await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1))[0];
	if (!tenant) return { items: [], completed: 0, total: 0, allDone: true, dismissed: true };

	// Only accounts that signed themselves up get the checklist. A tenant Makutano
	// provisioned was set up for the client by hand, and the three tenants that predate
	// self-signup must see their dashboard exactly as they did yesterday.
	if (tenant.provisioningSource !== 'SELF_SERVICE') {
		return { items: [], completed: 0, total: 0, allDone: true, dismissed: true };
	}

	// Once the card is finished or dismissed it never comes back, so skip the work
	// entirely rather than computing a checklist the dashboard will throw away.
	const dismissed = (tenant.settings as Record<string, unknown>)?.onboardingDismissed === true;
	if (dismissed || tenant.onboardingCompletedAt) {
		return { items: [], completed: 0, total: 0, allDone: !!tenant.onboardingCompletedAt, dismissed: true };
	}

	const entitlements = await effectiveEntitlements(tenantId);
	const can = (key: string) => entitlements.resolved[key]?.effective !== false;

	const [connections, members, templates, activity, integrations, listings] = await Promise.all([
		db()
			.select({ id: schema.whatsappConnections.id })
			.from(schema.whatsappConnections)
			.where(and(eq(schema.whatsappConnections.tenantId, tenantId), eq(schema.whatsappConnections.status, 'CONNECTED')))
			.limit(1),
		db().select({ id: schema.tenantMemberships.id }).from(schema.tenantMemberships).where(eq(schema.tenantMemberships.tenantId, tenantId)),
		count('whatsapp_templates', tenantId),
		count('booking_requests', tenantId).then(async (n) => n + (await count('orders', tenantId))),
		count('api_keys', tenantId).then(async (n) => n + (await count('webhook_endpoints', tenantId))),
		// A tour that has been SENT, not merely started. An empty draft is not a
		// listing, and this file's rule is that nothing ticks without the work.
		count('tours', tenantId, "and status in ('SUBMITTED','IN_REVIEW','APPROVED','PUBLISHED') and deleted_at is null")
	]);

	const settings = (tenant.settings ?? {}) as Record<string, unknown>;
	const workspace = normalizeWorkspace(settings.capabilities);
	const paymentMethods = Array.isArray(settings.paymentMethods) ? settings.paymentMethods : [];
	const systemSource = String(settings.systemSource ?? '');
	const usesExternalSystem =
		!!systemSource && systemSource !== 'CONNECT_MANUAL' && ['WEBSITE_CMS', 'BOOKING_SYSTEM', 'OTHER_SYSTEM'].includes(systemSource);

	const items: ChecklistItem[] = [
		{
			key: 'profile',
			label: 'Complete your business profile',
			description: 'Name, country, currency and contact details.',
			href: '/app/settings',
			done: !!(tenant.industry && tenant.businessPhone)
		}
	];

	// Second, for a tour operator, because it is the thing they came to do. The
	// marketplace's call to action is "List your tours" and the checklist used to
	// talk about everything except that.
	if (moduleRelevant(workspace, 'bookings')) {
		items.push({
			key: 'listing',
			label: 'List your first tour',
			description: 'Write it once; the Makutano team reviews it and puts it on the marketplace.',
			href: '/app/tours',
			done: listings > 0
		});
	}

	if (can('whatsapp.enabled')) {
		items.push({
			key: 'whatsapp',
			label: 'Connect your WhatsApp number',
			description: 'Reply to customers from the number they already know.',
			href: '/app/whatsapp',
			done: connections.length > 0
		});
	}

	if (can('whatsapp.enabled') && can('whatsapp.templatesEnabled')) {
		items.push({
			key: 'templates',
			label: 'Set up WhatsApp notifications',
			description: 'One tap creates the recommended message templates for your kind of business.',
			href: '/app/whatsapp/templates',
			done: settings.templatePack != null || templates > 0
		});
	}

	if (can('payments.enabled')) {
		items.push({
			key: 'payment_methods',
			label: 'Add how customers pay you',
			description: 'Bank, mobile money or Lipa Namba — shown on every payment request.',
			href: '/app/settings',
			done: paymentMethods.length > 0
		});
	}

	if (usesExternalSystem && can('api.enabled')) {
		items.push({
			key: 'integration',
			label: workspace === 'ORDERS' ? 'Connect your product or order system' : 'Connect your website or booking system',
			description: 'Create an API key or webhook so Connect can work beside your existing system.',
			href: '/app/developers',
			done: integrations > 0,
			permission: 'api_keys:read',
			// The only item here that is a genuine "if you want it". It appears
			// solely because signup asked what you used before and the answer was
			// not "nothing" — an answer nothing in the product could ever revise.
			optional: true
		});
	}

	items.push(
		{
			key: 'team',
			label: 'Invite a colleague',
			description: 'Share the inbox so nothing waits on one person.',
			href: '/app/settings/team',
			done: members.length > 1
		},
		{
			key: 'first_activity',
			label: 'Receive your first enquiry or order',
			description: 'This ticks itself the moment a customer gets in touch.',
			href: moduleRelevant(workspace, 'enquiries') ? '/app/booking-requests' : '/app/orders',
			done: activity > 0
		}
	);

	/*
	 * Only what this viewer can actually do.
	 *
	 * A row nobody in the room can complete is worse than no row: it pins the
	 * counter below 100% permanently and offers a button that leads to a refusal.
	 * An undone item the viewer lacks the permission for is dropped; a DONE one is
	 * kept, because "your business already did this" is useful to everybody.
	 *
	 * Passing no permissions keeps every item, so a caller that does not care —
	 * a report, a test — is unaffected.
	 */
	const visible = viewerPermissions.length
		? items.filter((i) => i.done || !i.permission || viewerPermissions.includes(i.permission))
		: items;

	const completed = visible.filter((i) => i.done).length;
	const allDone = completed === visible.length;

	// Record completion once, so admins can see who actually finished setting up.
	if (allDone && !tenant.onboardingCompletedAt) {
		await markOnboardingComplete(tenantId).catch(() => {});
	}

	return {
		items: visible,
		completed,
		total: visible.length,
		allDone,
		dismissed
	};
}

export async function markOnboardingComplete(tenantId: string): Promise<void> {
	await db()
		.update(schema.tenants)
		.set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
		.where(eq(schema.tenants.id, tenantId));
	await audit(tenantId, 'onboarding.completed', { type: 'system' }, { type: 'tenant', id: tenantId });
	log.info('onboarding_completed', { tenantId });
}

/** Hide the card without pretending the work is done — the items stay unticked. */
export async function dismissOnboarding(tenantId: string): Promise<void> {
	await db()
		.update(schema.tenants)
		.set({
			settings: sql`jsonb_set(coalesce(${schema.tenants.settings}, '{}'::jsonb), '{onboardingDismissed}', 'true'::jsonb, true)`,
			updatedAt: new Date()
		})
		.where(eq(schema.tenants.id, tenantId));
}

/**
 * "We do not need that" — recorded as the answer it actually is.
 *
 * The integration row appears because signup asked what the business used
 * before and got WEBSITE_CMS / BOOKING_SYSTEM / OTHER_SYSTEM. Nothing in the
 * product could ever change that answer afterwards, so an operator who has since
 * moved their work INTO Connect was stuck with a permanent to-do whose only
 * escape was creating an API key they did not want.
 *
 * This writes the answer signup would have stored had they said "just Connect",
 * so the row disappears for the reason it should: it is no longer true. It does
 * not invent a new kind of state, and it is reversible from the same place the
 * value came from.
 */
export async function markSystemSourceInternal(tenantId: string): Promise<void> {
	const [tenant] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
	if (!tenant) return;
	const settings = (tenant.settings ?? {}) as Record<string, unknown>;
	await db()
		.update(schema.tenants)
		.set({ settings: { ...settings, systemSource: 'CONNECT_MANUAL' }, updatedAt: new Date() })
		.where(eq(schema.tenants.id, tenantId));
}
