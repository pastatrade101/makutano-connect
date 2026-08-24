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
import { catalogRecommended, moduleRelevant, normalizeWorkspace } from '$lib/workspace';

export type ChecklistItem = {
	key: string;
	label: string;
	description: string;
	href: string;
	done: boolean;
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

export async function onboardingState(tenantId: string): Promise<OnboardingState> {
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

	const [connections, members, templates, catalog, activity, integrations] = await Promise.all([
		db()
			.select({ id: schema.whatsappConnections.id })
			.from(schema.whatsappConnections)
			.where(and(eq(schema.whatsappConnections.tenantId, tenantId), eq(schema.whatsappConnections.status, 'CONNECTED')))
			.limit(1),
		db().select({ id: schema.tenantMemberships.id }).from(schema.tenantMemberships).where(eq(schema.tenantMemberships.tenantId, tenantId)),
		count('whatsapp_templates', tenantId),
		count('catalog_items', tenantId),
		count('booking_requests', tenantId).then(async (n) => n + (await count('orders', tenantId))),
		count('api_keys', tenantId).then(async (n) => n + (await count('webhook_endpoints', tenantId)))
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
			done: integrations > 0
		});
	}

	// Only where reusable items speed up order entry. A tour operator's website stays
	// the source of truth for tours — Connect never asks them to recreate packages here.
	if (catalogRecommended(workspace) && can('orders.enabled') && !usesExternalSystem) {
		items.push({
			key: 'catalog',
			label: 'Add what you sell',
			description: 'Products or services customers order often — speeds up order entry.',
			href: '/app/catalog',
			done: catalog > 0
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

	const completed = items.filter((i) => i.done).length;
	const allDone = completed === items.length;

	// Record completion once, so admins can see who actually finished setting up.
	if (allDone && !tenant.onboardingCompletedAt) {
		await markOnboardingComplete(tenantId).catch(() => {});
	}

	return {
		items,
		completed,
		total: items.length,
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
