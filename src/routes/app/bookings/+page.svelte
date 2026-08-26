<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const STATUSES = ['DRAFT', 'PENDING', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
	const PAYMENTS = [{ value: 'unpaid', label: 'Unpaid only' }];
</script>

<svelte:head><title>Bookings · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Bookings" />
{:else}
<div class="space-y-3">
	<div><h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Bookings</h1><p class="mt-0.5 text-xs text-slate-400 sm:hidden">Confirmed work and balances</p></div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Total" value={data.stats.total} />
		<StatTile label="Pending" value={data.stats.pending} tone="warn" />
		<StatTile label="Confirmed" value={data.stats.confirmed} tone="good" />
		<StatTile label="Completed" value={data.stats.completed} />
		<StatTile label="Cancelled" value={data.stats.cancelled} />
		<StatTile label="Unpaid" value={data.stats.unpaid} tone={data.stats.unpaid ? 'bad' : 'default'} />
	</div>

	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} payments={PAYMENTS} placeholder="Search booking reference…" />
		{#if data.items.length === 0}
			<EmptyState
					title="No bookings in this view"
					description="A booking appears when a traveller accepts a quotation, or when you convert one yourself. Start from the enquiry, quote it, and accept it on their behalf."
					action={{ href: '/app/quotations', label: 'Go to quotations' }}
					secondary={{ href: '/app/booking-requests', label: 'Enquiries' }}
				/>
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50">
						<tr>
							<th class="table-head">Reference</th><th class="table-head">Traveller</th><th class="table-head">Status</th>
							<th class="table-head">Total</th><th class="table-head">Paid</th><th class="table-head">Balance</th><th class="table-head">Created</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.booking.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title"><a href="/app/bookings/{row.booking.id}" class="font-semibold text-brand-600 hover:underline">{row.booking.bookingReference}</a><div class="mt-1 sm:hidden"><StatusBadge value={row.booking.status} /></div></td>
								<td class="table-cell" data-label="Traveller">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={row.booking.status} /></td>
								<td class="table-cell font-semibold" data-label="Total"><Money amount={row.booking.total} currency={row.booking.currency} /></td>
								<td class="table-cell" data-label="Paid"><Money amount={row.booking.amountPaid} currency={row.booking.currency} /></td>
								<td class="table-cell {Number(row.booking.balanceDue) > 0 ? 'font-medium text-danger' : 'text-slate-500'}" data-label="Balance">
									<Money amount={row.booking.balanceDue} currency={row.booking.currency} />
								</td>
								<td class="table-cell text-slate-500" data-label="Created"><TimeAgo value={row.booking.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
{/if}
