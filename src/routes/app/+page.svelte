<script lang="ts">
	import Money from '$components/Money.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const s = $derived(data.stats);
	const tz = $derived(data.tenant.timezone);
</script>

<svelte:head><title>Overview · {data.tenant.name}</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-semibold text-slate-900">Overview</h1>
		<a href="/app/booking-requests" class="btn-secondary">All requests</a>
	</div>

	{#if !data.whatsapp || data.whatsapp.status !== 'CONNECTED'}
		<div class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
			<span>WhatsApp is not connected — traveller acknowledgements and replies are paused.</span>
			<a href="/app/whatsapp" class="font-semibold underline">Connect WhatsApp</a>
		</div>
	{/if}

	<!-- §22: Total, Pending, Confirmed, Completed, Cancelled, Unpaid -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Requests" value={s.requests.total} hint="{s.requests.last7Days} this week" href="/app/booking-requests" />
		<StatTile label="Pending" value={s.requests.pending} tone="warn" href="/app/booking-requests?status=NEW" />
		<StatTile label="Confirmed" value={s.bookings.confirmed} tone="good" href="/app/bookings?status=CONFIRMED" />
		<StatTile label="Completed" value={s.bookings.completed} href="/app/bookings?status=COMPLETED" />
		<StatTile label="Cancelled" value={s.bookings.cancelled} href="/app/bookings?status=CANCELLED" />
		<StatTile label="Unpaid" value={s.bookings.unpaid} tone={s.bookings.unpaid > 0 ? 'bad' : 'default'} href="/app/bookings?payment=unpaid" />
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<section class="card lg:col-span-2">
			<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
				<h2 class="text-sm font-semibold text-slate-800">Latest booking requests</h2>
				<a href="/app/booking-requests" class="text-xs text-brand-700 hover:underline">View all</a>
			</header>
			{#if data.recentRequests.length === 0}
				<p class="px-3 py-8 text-center text-xs text-slate-500">No booking requests yet.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-slate-100">
						<thead class="bg-slate-50">
							<tr>
								<th class="table-head">Reference</th>
								<th class="table-head">Traveller</th>
								<th class="table-head">Status</th>
								<th class="table-head">Value</th>
								<th class="table-head">Received</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.recentRequests as row (row.request.id)}
								<tr class="hover:bg-slate-50">
									<td class="table-cell">
										<a href="/app/booking-requests/{row.request.id}" class="font-medium text-brand-800 hover:underline">{row.request.reference}</a>
									</td>
									<td class="table-cell">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
									<td class="table-cell"><StatusBadge value={row.request.status} /></td>
									<td class="table-cell"><Money amount={row.request.estimatedTotal} currency={row.request.currency} /></td>
									<td class="table-cell text-slate-500"><TimeAgo value={row.request.createdAt} timezone={tz} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card">
			<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
				<h2 class="text-sm font-semibold text-slate-800">Open conversations</h2>
				<a href="/app/conversations" class="text-xs text-brand-700 hover:underline">Inbox</a>
			</header>
			{#if data.inbox.length === 0}
				<p class="px-3 py-8 text-center text-xs text-slate-500">Nothing waiting for a reply.</p>
			{:else}
				<ul class="divide-y divide-slate-100">
					{#each data.inbox as row (row.conversation.id)}
						<li>
							<a href="/app/conversations/{row.conversation.id}" class="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50">
								<span class="min-w-0">
									<span class="block truncate text-sm text-slate-800">
										{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || row.conversation.externalId || 'Unknown'}
									</span>
									<span class="block truncate text-[11px] text-slate-500">{row.conversation.subject ?? row.conversation.channel}</span>
								</span>
								<span class="flex shrink-0 items-center gap-2">
									{#if row.conversation.unreadCount > 0}
										<span class="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold text-white">{row.conversation.unreadCount}</span>
									{/if}
									<span class="text-[11px] text-slate-400"><TimeAgo value={row.conversation.lastMessageAt} timezone={tz} /></span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Customers" value={s.customers.total} hint="{s.customers.last30Days} new in 30 days" href="/app/customers" />
		<StatTile label="Confirmed value" value={s.bookings.confirmedValue.toFixed(0)} hint={data.tenant.currency} />
		<StatTile label="Collected" value={s.payments.collected.toFixed(0)} hint={data.tenant.currency} tone="good" href="/app/payments" />
		<StatTile label="Failed payments" value={s.payments.failed} tone={s.payments.failed > 0 ? 'bad' : 'default'} href="/app/payments?status=FAILED" />
	</div>
</div>
