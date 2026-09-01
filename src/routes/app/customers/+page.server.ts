// Travellers, read-only.
//
// There is no create action here on purpose. A traveller with no enquiry,
// quotation or booking behind them is a name in a table: everyone on this list
// arrived WITH work — an enquiry from the marketplace, a WhatsApp message, a
// quotation raised for them — and every one of those paths already creates the
// person as part of doing the thing. A separate "add a customer" button made a
// second way to create half a record.
import { requireTenant, requireTenantPermission } from '$lib/server/guards';
import { listCustomers } from '$lib/server/customers';
import { paginationFrom } from '$lib/server/http';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireTenantPermission(locals, 'customers:read');
	const pagination = paginationFrom(url);
	const { items, total } = await listCustomers(requireTenant(locals).id, pagination);
	return { items, total, pagination };
};
