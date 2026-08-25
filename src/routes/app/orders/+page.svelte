<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import { sourceLabel, statusLabel } from '$lib/labels';
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED'].map((v) => ({ value: v, label: statusLabel(v) }));
	const PAYMENTS = [{ value: 'unpaid', label: 'Unpaid only' }, { value: 'PAID', label: 'Paid' }, { value: 'PARTIALLY_PAID', label: 'Partially paid' }];
	const SOURCES = ['WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'WHATSAPP_GROUP', 'PHONE', 'WALK_IN', 'WEBSITE', 'ORDER_LINK', 'INSTAGRAM', 'FACEBOOK', 'MANUAL', 'API', 'OTHER'].map((v) => ({ value: v, label: sourceLabel(v) }));
</script>

<svelte:head><title>Orders · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Orders" />
{:else}
<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-semibold text-slate-800">Orders</h1>
		<div class="flex gap-2">
			<a href="/app/orders/batches" class="btn-secondary">Batches</a>
			<a href="/app/orders/links" class="btn-secondary">Order Links</a>
			<a href="/app/orders/new" class="btn-primary">New order</a>
		</div>
	</div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Total" value={data.stats.total} />
		<StatTile label="Pending" value={data.stats.pending} tone="warn" href="/app/orders?status=PENDING_CONFIRMATION" />
		<StatTile label="In progress" value={data.stats.inProgress} href="/app/orders?status=CONFIRMED" />
		<StatTile label="Dispatched" value={data.stats.dispatched} href="/app/orders?status=DISPATCHED" />
		<StatTile label="Delivered" value={data.stats.delivered} tone="good" href="/app/orders?status=DELIVERED" />
		<StatTile label="Unpaid" value={data.stats.unpaid} tone={data.stats.unpaid ? 'bad' : 'default'} href="/app/orders?payment=unpaid" />
	</div>

	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} payments={PAYMENTS} sources={SOURCES} placeholder="Search order number, customer, item…" />
		{#if data.items.length === 0}
			<EmptyState title="No orders in this view" description="Orders arrive from WhatsApp conversations, hosted forms, the API — or create one manually." action={{ href: '/app/orders/new', label: 'Create an order' }} />
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50">
						<tr>
							<th class="table-head">Order</th><th class="table-head">Customer</th><th class="table-head">Items</th>
							<th class="table-head">Total</th><th class="table-head">Payment</th><th class="table-head">Status</th>
							<th class="table-head">Source</th><th class="table-head">Created</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as row (row.order.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell"><a href="/app/orders/{row.order.id}" class="font-medium text-brand-600 hover:underline">{row.order.orderNumber}</a></td>
								<td class="table-cell">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
								<td class="table-cell max-w-[16rem] truncate text-slate-500">{row.itemsSummary ?? '—'}</td>
								<td class="table-cell"><Money amount={row.order.total} currency={row.order.currency} /></td>
								<td class="table-cell"><StatusBadge value={row.order.paymentStatus} size="xs" /></td>
								<td class="table-cell"><StatusBadge value={row.order.status} /></td>
								<td class="table-cell text-[12.5px] text-slate-400">{sourceLabel(row.order.source)}</td>
								<td class="table-cell text-slate-500"><TimeAgo value={row.order.createdAt} timezone={data.tenant.timezone} /></td>
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
