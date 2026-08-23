// The ONE place that decides which modules a workspace considers relevant (§10 of the
// business-aware brief). Nothing here is authorization: entitlements and permissions
// are still checked wherever features are used — this module only answers "does this
// kind of business care about this module at all?"
//
// Shared by server loads and Svelte components; keep it dependency-free.

export type Workspace = 'BOOKINGS' | 'ORDERS' | 'SERVICE' | 'HYBRID';

/** Legacy tenants stored 'BOTH'; unknown values fail open to the everything view. */
export function normalizeWorkspace(value: unknown): Workspace {
	const v = String(value ?? '');
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
	BOOKINGS: new Set<Module>(['enquiries', 'bookings', 'quotations', 'leads']),
	// WhatsApp seller: conversation → order → payment. Booking flows never appear.
	ORDERS: new Set<Module>(['orders', 'catalog']),
	// Service business: enquiry → conversation → quote → payment. Neither orders nor bookings.
	SERVICE: new Set<Module>(['enquiries', 'quotations', 'leads']),
	// Genuinely both — e.g. a lodge with rooms AND a shop. Never the default for simplicity.
	HYBRID: new Set<Module>(['enquiries', 'bookings', 'orders', 'quotations', 'catalog', 'leads'])
};

/** Is this module part of this kind of business's world? (Relevance, not access.) */
export function moduleRelevant(workspace: Workspace, module: Module): boolean {
	return RELEVANCE[workspace].has(module);
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
