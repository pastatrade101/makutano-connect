import { getMarketplacePerformance, parseMarketplaceRange } from '$lib/server/marketplace-analytics';
import { requireTenantPermission } from '$lib/server/guards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const tenant = requireTenantPermission(locals, 'marketplace_analytics:read');
	const range = parseMarketplaceRange(url.searchParams.get('range'));
	return {
		performance: await getMarketplacePerformance(tenant.id, range, tenant.timezone),
		timezone: tenant.timezone
	};
};
