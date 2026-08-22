import { bookingRequestStats } from '$lib/server/booking-requests';
import { bookingStats } from '$lib/server/bookings';
import { customerStats } from '$lib/server/customers';
import { paymentStats } from '$lib/server/payments';
import { listConversations } from '$lib/server/conversations';
import { listBookingRequests } from '$lib/server/booking-requests';
import { getConnectionForTenant, toSafeConnection } from '$lib/server/whatsapp/connections';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = locals.tenant!.id;
	const pagination = { page: 1, limit: 8, order: 'desc' as const };

	const [requests, bookings, customers, payments, recent, inbox, connection] = await Promise.all([
		bookingRequestStats(tenantId),
		bookingStats(tenantId),
		customerStats(tenantId),
		paymentStats(tenantId),
		listBookingRequests(tenantId, pagination),
		listConversations(tenantId, pagination, { open: true }),
		getConnectionForTenant(tenantId)
	]);

	return {
		stats: { requests, bookings, customers, payments },
		recentRequests: recent.items,
		inbox: inbox.items,
		whatsapp: connection ? toSafeConnection(connection) : null
	};
};
