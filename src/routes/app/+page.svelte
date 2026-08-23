<script lang="ts">
	import { page } from '$app/state';
	import Chart from '$components/Chart.svelte';
	import OnboardingChecklist from '$components/OnboardingChecklist.svelte';
	import Money from '$components/Money.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const s = $derived(data.stats);
	const c = $derived(data.centre as Record<string, unknown>);
	const caps = $derived(data.tenant.capabilities);
	const n = (key: string) => Number(c?.[key] ?? 0);

	/** §5 — what needs me, each one a link straight to the work. */
	const attention = $derived.by(() => {
		const items: Array<{ label: string; count: number; href: string; tone: 'warn' | 'info' | 'bad' }> = [];
		if (n('unread_chats')) items.push({ label: n('unread_chats') === 1 ? 'conversation waiting for a reply' : 'conversations waiting for a reply', count: n('unread_chats'), href: '/app/conversations', tone: 'info' });
		if (caps !== 'ORDERS' && n('new_enquiries')) items.push({ label: n('new_enquiries') === 1 ? 'new enquiry' : 'new enquiries', count: n('new_enquiries'), href: '/app/booking-requests?status=NEW', tone: 'warn' });
		if (caps !== 'BOOKINGS' && n('orders_to_confirm')) items.push({ label: n('orders_to_confirm') === 1 ? 'order awaiting confirmation' : 'orders awaiting confirmation', count: n('orders_to_confirm'), href: '/app/orders?status=PENDING_CONFIRMATION', tone: 'warn' });
		if (caps !== 'BOOKINGS' && n('orders_ready')) items.push({ label: n('orders_ready') === 1 ? 'order ready for delivery' : 'orders ready for delivery', count: n('orders_ready'), href: '/app/orders?status=READY', tone: 'info' });
		if (caps !== 'ORDERS' && n('bookings_unpaid')) items.push({ label: n('bookings_unpaid') === 1 ? 'booking awaiting payment' : 'bookings awaiting payment', count: n('bookings_unpaid'), href: '/app/bookings?payment=unpaid', tone: 'bad' });
		if (n('quotes_waiting')) items.push({ label: n('quotes_waiting') === 1 ? 'quotation awaiting response' : 'quotations awaiting response', count: n('quotes_waiting'), href: '/app/quotations?status=SENT', tone: 'info' });
		return items;
	});

	const quickActions = $derived.by(() => {
		const items: Array<{ href: string; label: string }> = [];
		const can = (perm: string) => data.permissions?.includes(perm as never);
		if (caps !== 'BOOKINGS' && data.entitlements?.['orders.enabled'] === true && can('orders:write')) {
			if (c?.open_batch_id) items.push({ href: `/app/orders/batches/${c.open_batch_id}`, label: `Open batch: ${String(c.open_batch_name ?? '').slice(0, 26)}` });
			items.push({ href: '/app/orders/new', label: 'New order' });
		}
		if (caps !== 'ORDERS' && can('booking_requests:write')) items.push({ href: '/app/booking-requests', label: 'New enquiry' });
		items.push({ href: '/app/conversations', label: 'Open inbox' });
		if (can('customers:write')) items.push({ href: '/app/customers?new=1', label: 'New customer' });
		return items.slice(0, 4);
	});
	// ?welcome=1 arrives once, straight after signup — it only changes the wording.
	const justSignedUp = $derived(page.url.searchParams.get('welcome') === '1');
	const tz = $derived(data.tenant.timezone);

	// Reback-style smooth area chart: brand + info series over the last fortnight.
	const chartOptions = $derived({
		chart: { type: 'area' as const, height: 240, toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false } },
		series: [
			{ name: 'Enquiries', data: data.activity.requests },
			{ name: 'Messages', data: data.activity.messages }
		],
		xaxis: { categories: data.activity.labels, labels: { style: { colors: '#8486a7', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
		yaxis: { labels: { style: { colors: '#8486a7', fontSize: '11px' } } },
		colors: ['#1c84ee', '#4ecac2'],
		stroke: { curve: 'smooth' as const, width: 2.5 },
		fill: { type: 'gradient', gradient: { opacityFrom: 0.25, opacityTo: 0.02 } },
		dataLabels: { enabled: false },
		grid: { borderColor: '#eaedf1', strokeDashArray: 4 },
		legend: { labels: { colors: '#5d7186' } },
		tooltip: { theme: 'light' as const }
	});
</script>

<svelte:head><title>Overview · {data.tenant.name}</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-semibold text-slate-900">Home</h1>
		{#if caps === 'ORDERS'}
			<a href="/app/orders/batches" class="btn-secondary">Batches</a>
		{:else}
			<a href="/app/booking-requests" class="btn-secondary">All enquiries</a>
		{/if}
	</div>

	{#if data.onboarding}
		<OnboardingChecklist
			items={data.onboarding.items}
			completed={data.onboarding.completed}
			total={data.onboarding.total}
			welcome={justSignedUp}
		/>
	{/if}

	<!-- §5 Needs your attention -->
	{#if attention.length}
		<section class="card divide-y divide-slate-100">
			{#each attention as item (item.href)}
				<a href={item.href} class="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
					<span class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold {item.tone === 'bad' ? 'bg-danger/10 text-danger' : item.tone === 'warn' ? 'bg-warning/15 text-[#b58514]' : 'bg-brand-50 text-brand-600'}">{item.count}</span>
					<span class="flex-1 text-sm text-slate-700">{item.count} {item.label}</span>
					<svg class="size-4 text-slate-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 5 5 5-5 5" /></svg>
				</a>
			{/each}
		</section>
	{:else}
		<section class="card flex items-center gap-3 px-4 py-3">
			<span class="flex size-7 items-center justify-center rounded-full bg-success/10 text-success">✓</span>
			<span class="text-sm text-slate-600">All caught up — nothing needs your attention right now.</span>
		</section>
	{/if}

	<!-- §5 Today -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">New chats today</div><div class="text-lg font-bold tabular-nums text-slate-800">{n('chats_today')}</div></div>
		{#if caps !== 'BOOKINGS'}
			<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Orders today</div><div class="text-lg font-bold tabular-nums text-slate-800">{n('orders_today')}</div></div>
		{/if}
		{#if caps !== 'ORDERS'}
			<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Enquiries today</div><div class="text-lg font-bold tabular-nums text-slate-800">{n('enquiries_today')}</div></div>
		{/if}
		<div class="card px-3 py-2"><div class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Received today</div><div class="text-lg font-bold tabular-nums text-success"><Money amount={String(c?.received_today ?? '0')} currency={data.tenant.currency} /></div></div>
	</div>

	<!-- §5 Quick actions -->
	<div class="flex flex-wrap gap-2">
		{#each quickActions as action, i (action.href)}
			<a href={action.href} class={i === 0 ? 'btn-primary' : 'btn-secondary'}>{action.label}</a>
		{/each}
	</div>

	{#if !data.whatsapp || data.whatsapp.status !== 'CONNECTED'}
		<div class="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">
			<span>WhatsApp is not connected — traveller acknowledgements and replies are paused.</span>
			<a href="/app/whatsapp" class="font-semibold underline">Connect WhatsApp</a>
		</div>
	{/if}

	<!-- Booking KPIs — hidden for order-only businesses -->
	{#if caps !== 'ORDERS'}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Requests" value={s.requests.total} hint="{s.requests.last7Days} this week" href="/app/booking-requests" />
		<StatTile label="Pending" value={s.requests.pending} tone="warn" href="/app/booking-requests?status=NEW" />
		<StatTile label="Confirmed" value={s.bookings.confirmed} tone="good" href="/app/bookings?status=CONFIRMED" />
		<StatTile label="Completed" value={s.bookings.completed} href="/app/bookings?status=COMPLETED" />
		<StatTile label="Cancelled" value={s.bookings.cancelled} href="/app/bookings?status=CANCELLED" />
		<StatTile label="Unpaid" value={s.bookings.unpaid} tone={s.bookings.unpaid > 0 ? 'bad' : 'default'} href="/app/bookings?payment=unpaid" />
	</div>
	{/if}

	<section class="card">
		<header class="card-header">
			<h2 class="card-title">Activity — last 14 days</h2>
		</header>
		<div class="px-2 pt-2">
			<Chart options={chartOptions} />
		</div>
	</section>

	<div class="grid gap-4 lg:grid-cols-3">
		{#if caps !== 'ORDERS'}
		<section class="card lg:col-span-2">
			<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
				<h2 class="text-sm font-semibold text-slate-800">Latest enquiries</h2>
				<a href="/app/booking-requests" class="text-xs text-brand-600 hover:underline">View all</a>
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
										<a href="/app/booking-requests/{row.request.id}" class="font-medium text-brand-600 hover:underline">{row.request.reference}</a>
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
		{/if}

		<section class="card">
			<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
				<h2 class="text-sm font-semibold text-slate-800">Open conversations</h2>
				<a href="/app/conversations" class="text-xs text-brand-600 hover:underline">Inbox</a>
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
										<span class="rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-white">{row.conversation.unreadCount}</span>
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
