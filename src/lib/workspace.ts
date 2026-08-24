// The ONE place that decides which modules a workspace considers relevant (§10 of the
// business-aware brief). Nothing here is authorization: entitlements and permissions
// are still checked wherever features are used — this module only answers "does this
// kind of business care about this module at all?"
//
// Shared by server loads and Svelte components; keep it dependency-free.

export type Workspace = 'BOOKINGS' | 'ORDERS' | 'SERVICE' | 'HYBRID';

/** Legacy tenants stored 'BOTH'; unknown values fail open to the everything view. */
export function normalizeWorkspace(value: unknown): Workspace {
	// Tolerates accidentally double-encoded values ('"BOOKINGS"') from raw jsonb writes.
	const v = String(value ?? '').replace(/^"|"$/g, '');
	if (v === 'BOOKINGS' || v === 'ORDERS' || v === 'SERVICE') return v;
	return 'HYBRID';
}

export type Module =
	| 'enquiries' // booking requests
	| 'bookings'
	| 'orders' // includes batches
	| 'quotations'
	| 'catalog'
	| 'leads';

const RELEVANCE: Record<Workspace, ReadonlySet<Module>> = {
	// Tour operator: enquiry → quote → booking → payment. Orders never appear.
	// Catalog is reachable as an optional tool (see catalogRecommended) — their
	// website stays the source of truth for tours; Connect never asks to recreate them.
	BOOKINGS: new Set<Module>(['enquiries', 'bookings', 'quotations', 'catalog', 'leads']),
	// WhatsApp seller: conversation → order → payment. Booking flows never appear.
	ORDERS: new Set<Module>(['orders', 'catalog']),
	// Service business: enquiry → conversation → quote → payment. Neither orders nor bookings.
	SERVICE: new Set<Module>(['enquiries', 'quotations', 'catalog', 'leads']),
	// Genuinely both — e.g. a lodge with rooms AND a shop. Never the default for simplicity.
	HYBRID: new Set<Module>(['enquiries', 'bookings', 'orders', 'quotations', 'catalog', 'leads'])
};

/** Is this module part of this kind of business's world? (Relevance, not access.) */
export function moduleRelevant(workspace: Workspace, module: Module): boolean {
	return RELEVANCE[workspace].has(module);
}

/**
 * Should Connect actively suggest filling the catalog? Only where reusable items
 * genuinely speed up daily work (order entry). For BOOKINGS and SERVICE the catalog
 * is a quiet optional tool: no onboarding step, no empty-state nagging, nothing
 * blocked when it is empty — the tenant's own website/CMS remains the source of truth.
 */
export function catalogRecommended(workspace: Workspace): boolean {
	return workspace === 'ORDERS' || workspace === 'HYBRID';
}

/** How the catalog presents itself per business type — same feature, honest framing. */
export function catalogCopy(workspace: Workspace): { label: string; hint: string } {
	switch (workspace) {
		case 'BOOKINGS':
			return {
				label: 'Services & Packages',
				hint: 'Optional — add frequently used tours or services for faster manual bookings and quotations. Your website can remain your source of truth.'
			};
		case 'SERVICE':
			return {
				label: 'Services & Packages',
				hint: 'Optional — add the services you quote most so staff never retype names and prices.'
			};
		default:
			return {
				label: 'Catalog',
				hint: 'A quick-pick list for orders, quotes and forms — not inventory management.'
			};
	}
}

/**
 * The check every surface should compose: relevant to the workspace AND allowed by the
 * plan AND permitted for the user. Pass `entitled`/`permitted` as already-resolved
 * booleans — this module never reads entitlements itself.
 */
export function showModule(
	workspace: Workspace,
	module: Module,
	entitled: boolean,
	permitted: boolean
): boolean {
	return moduleRelevant(workspace, module) && entitled && permitted;
}

/** Copy for onboarding + Settings — business language, never the word "workspace". */
export const WORKSPACE_OPTIONS: ReadonlyArray<{
	value: Workspace;
	label: string;
	hint: string;
}> = [
	{
		value: 'BOOKINGS',
		label: 'Bookings & reservations',
		hint: 'Tours, accommodation, appointments and reservation businesses'
	},
	{
		value: 'ORDERS',
		label: 'Customer orders',
		hint: 'Businesses taking simple customer orders — fish, food, products'
	},
	{
		value: 'SERVICE',
		label: 'Enquiries & quotations',
		hint: 'Service businesses that quote for work'
	},
	{
		value: 'HYBRID',
		label: 'Bookings + orders',
		hint: 'Businesses genuinely needing both'
	}
];

/** Sensible default per industry (§6). The user can always pick something else. */
export function workspaceForIndustry(industry: string | null | undefined): Workspace {
	switch (industry) {
		case 'TRAVEL_TOURISM':
		case 'HOSPITALITY':
		case 'EDUCATION':
		case 'HEALTHCARE':
			return 'BOOKINGS';
		case 'RETAIL':
		case 'RESTAURANT_FOOD':
			return 'ORDERS';
		case 'PROFESSIONAL_SERVICES':
		case 'REAL_ESTATE':
			return 'SERVICE';
		default:
			return 'HYBRID';
	}
}
