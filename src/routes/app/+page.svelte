<script lang="ts">
	import { page } from '$app/state';
	import Chart from '$components/Chart.svelte';
	import { chartPalette, theme } from '$lib/stores/theme.svelte';
	import OnboardingChecklist from '$components/OnboardingChecklist.svelte';
	import { moduleRelevant } from '$lib/workspace';
	import Money from '$components/Money.svelte';
	import StatTile from '$components/StatTile.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const s = $derived(data.stats);
	const c = $derived(data.centre as Record<string, unknown>);
	const caps = $derived(data.tenant.capabilities);
	const n = (key: string) => Number(c?.[key] ?? 0);

	/** Attention is derived on the server now — visibility-scoped, already ordered. */
	const rel = (m: Parameters<typeof moduleRelevant>[1]) => moduleRelevant(caps, m);
	const can = (perm: string) => data.permissions?.includes(perm as never) ?? false;
	const attention = $derived(data.attention ?? []);
	const persona = $derived(data.persona ?? 'owner');
	/** Analytics is for people who watch the business, not people working a queue. */
	const showAnalytics = $derived(persona === 'owner');

	const quickActions = $derived.by(() => {
		const items: Array<{ href: string; label: string }> = [];
		// Four conditions, every time: relevant to this business, allowed by the plan,
		// permitted for this person, and useful for what they are actually responsible for.
		const ent = (key: string) => data.entitlements?.[key] === true;

		if (persona === 'finance') {
			if (can('payments:verify')) items.push({ href: '/app/payments?verify=1', label: 'Verify payments' });
			if (can('payments:read')) items.push({ href: '/app/payments', label: 'Payment history' });
			return items;
		}
		if (persona === 'viewer') return items; // nothing to create; no decorative buttons

		if (rel('orders') && ent('orders.enabled') && can('orders:write')) {
			if (c?.open_batch_id) items.push({ href: `/app/orders/batches/${c.open_batch_id}`, label: `Open batch: ${String(c.open_batch_name ?? '').slice(0, 26)}` });
			items.push({ href: '/app/orders/new', label: 'New order' });
			if (persona === 'owner' && can('order_links:write') && ent('orderLinks.enabled')) {
				items.push({ href: '/app/orders/links', label: 'Order link' });
			}
		}
		if (rel('enquiries') && can('booking_requests:write')) items.push({ href: '/app/booking-requests/new', label: 'New enquiry' });
		if (can('conversations:read')) items.push({ href: '/app/conversations', label: 'Open inbox' });
		if (can('customers:write')) items.push({ href: '/app/customers?new=1', label: 'New customer' });
		return items.slice(0, 4);
	});

	// "Where does work come from?" — the question a new account cannot answer, and the
	// one Connect never used to answer. Shown until the first enquiry or order lands.
	// "Started" means started at the work THIS business does: a seller with one stray
	// enquiry has still never taken an order, and still needs to be told how.
	const started = $derived((rel('enquiries') ? n('enquiries_total') : 0) + (rel('orders') ? n('orders_total') : 0) > 0);
	const routesIn = $derived.by(() => {
		const can = (perm: string) => data.permissions?.includes(perm as never);
		const routes: Array<{ title: string; body: string; href: string; label: string }> = [];
		if (rel('orders') && data.entitlements?.['orders.enabled'] === true && can('orders:write')) {
			routes.push({ title: 'Share an order link', body: 'One offer, one link. Post it in a WhatsApp group or status and orders arrive here already structured.', href: '/app/orders/links', label: 'Create an order link' });
			routes.push({ title: 'Take it in the chat', body: 'A customer writes what they want; you record the order from the conversation without leaving it.', href: '/app/conversations', label: 'Open inbox' });
			routes.push({ title: 'Write one down', body: 'Someone orders by phone or in person — record it yourself in a few seconds.', href: '/app/orders/new', label: 'New order' });
		} else if (rel('enquiries')) {
			routes.push({ title: 'From WhatsApp', body: 'A traveller writes to your number. Open the message and turn it into an enquiry in one step.', href: '/app/conversations', label: 'Open inbox' });
			routes.push({ title: 'From your website', body: 'Keep your site as it is — send its enquiries into Connect through a form, widget or the API.', href: '/app/forms', label: 'Set up a form' });
			if (can('booking_requests:write')) routes.push({ title: 'By phone or in person', body: 'Log what they asked for while you are still talking to them.', href: '/app/booking-requests/new', label: 'Log an enquiry' });
		}
		return routes;
	});

	const greeting = $derived.by(() => {
		const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone: data.tenant.timezone }).format(new Date()));
		const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
		const first = (data.user.fullName || '').trim().split(/\s+/)[0];
		return first ? `${part}, ${first}` : part;
	});
	// ?welcome=1 arrives once, straight after signup — it only changes the wording.
	const justSignedUp = $derived(page.url.searchParams.get('welcome') === '1');
	const tz = $derived(data.tenant.timezone);

	// Reback-style smooth area chart: brand + info series over the last fortnight.
	const pal = $derived(chartPalette(theme.dark));
	const chartOptions = $derived({
		chart: { type: 'area' as const, height: 240, toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false } },
		series: [
			{ name: 'Enquiries', data: data.activity.requests },
			{ name: 'Messages', data: data.activity.messages }
		],
		xaxis: { categories: data.activity.labels, labels: { style: { colors: pal.label, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
		yaxis: { labels: { style: { colors: pal.label, fontSize: '11px' } } },
		colors: ['#1c84ee', '#4ecac2'],
		stroke: { curve: 'smooth' as const, width: 2.5 },
		fill: { type: 'gradient', gradient: { opacityFrom: 0.25, opacityTo: 0.02 } },
		dataLabels: { enabled: false },
		grid: { borderColor: pal.grid, strokeDashArray: 4 },
		legend: { labels: { colors: pal.legend } },
		tooltip: { theme: pal.tooltip }
	});
</script>

<svelte:head><title>Overview · {data.tenant.name}</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900">{greeting}</h1>
		<p class="mt-0.5 text-[13px] text-slate-500">
			{attention.length ? "Here's what needs your attention." : 'Nothing is waiting on you right now.'}
		</p>
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
			{#each attention as item (item.key)}
				<a href={item.href} class="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
					<span class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold {item.urgency === 'critical' ? 'bg-danger/10 text-danger' : item.urgency === 'high' ? 'bg-warning/15 text-[#b58514]' : 'bg-brand-50 text-brand-600'}">{item.count}</span>
					<span class="flex-1 text-sm text-slate-700">{item.label}</span>
					{#if item.scope === 'mine'}
						<span class="shrink-0 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-semibold text-brand-600">yours</span>
					{/if}
					<svg class="size-4 shrink-0 text-slate-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 5 5 5-5 5" /></svg>
				</a>
			{/each}
		</section>
	{:else}
		<section class="card flex items-center gap-3 px-4 py-3">
			<span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">✓</span>
			<span class="text-sm text-slate-600">
				{persona === 'agent' ? "You're caught up — nothing assigned to you is waiting." : persona === 'finance' ? 'No payments are waiting to be checked.' : 'All caught up — nothing needs your attention right now.'}
			</span>
			{#if persona === 'agent' && can('conversations:read')}
				<a href="/app/conversations" class="ml-auto shrink-0 text-[13px] font-medium text-brand-600 hover:underline">Open the inbox</a>
			{/if}
		</section>
	{/if}

	<!-- What you were in the middle of, as business: who, where it stands, and the
	     one fact that makes it actionable. Deliberately not a list of recent chats. -->
	{#if data.continueWorking?.length}
		<section class="card">
			<header class="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
				<h2 class="text-sm font-semibold text-slate-800">Continue working</h2>
				{#if can('conversations:read')}
					<a href="/app/conversations?filter=mine" class="text-xs text-brand-600 hover:underline">Your chats</a>
				{/if}
			</header>
			<ul class="divide-y divide-slate-100">
				{#each data.continueWorking as item (item.kind + (item.recordId ?? item.conversationId))}
					<li>
						<a
							href={item.conversationId ? `/app/conversations/${item.conversationId}` : '/app/conversations'}
							class="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50"
						>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium text-slate-800">{item.customer}</span>
								<span class="block truncate text-[12.5px] text-slate-500">{item.state}</span>
								{#if item.detail}<span class="block truncate text-[12.5px] text-slate-400">{item.detail}</span>{/if}
							</span>
							{#if item.mine}
								<span class="shrink-0 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-semibold text-brand-600">yours</span>
							{/if}
							<span class="shrink-0 text-[12.5px] text-slate-400"><TimeAgo value={item.at} timezone={tz} /></span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- True, and worth knowing, but not this person's move. -->
	{#if data.context?.length}
		<section class="flex flex-col gap-1 rounded-panel bg-slate-50 px-4 py-2.5">
			{#each data.context as item (item.key)}
				<p class="text-[13px] text-slate-500">
					{#if can('payments:read')}
						<a href={item.href} class="hover:underline">{item.label}</a>
					{:else}{item.label}{/if}
				</p>
			{/each}
		</section>
	{/if}

	<!-- §5 Quick actions — what I can do right now, in this business. A person with
	     nothing to create gets no empty row of buttons. -->
	{#if quickActions.length}
		<div class="flex flex-wrap gap-2">
			{#each quickActions as action, i (action.href)}
				<a href={action.href} class={i === 0 ? 'btn-primary' : 'btn-secondary'}>{action.label}</a>
			{/each}
		</div>
	{/if}

	{#if !started && routesIn.length}
		<section class="card p-4 sm:p-5">
			<h2 class="text-sm font-semibold text-slate-800">{rel('orders') && !rel('enquiries') ? 'How do you want to receive orders?' : 'How enquiries reach you'}</h2>
			<p class="mt-1 text-[13px] text-slate-500">Pick whichever fits how you already work — you can use all three.</p>
			<div class="mt-4 grid gap-2 sm:grid-cols-3">
				{#each routesIn as route (route.href)}
					<div class="flex flex-col rounded-xl border border-slate-200 p-3.5">
						<p class="text-[13.5px] font-semibold text-slate-800">{route.title}</p>
						<p class="mt-1 flex-1 text-[12px] leading-5 text-slate-500">{route.body}</p>
						<a href={route.href} class="btn-secondary mt-3 !py-1.5 text-xs">{route.label}</a>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- §5 Today — scoped to what this person is responsible for -->
	{#if data.today?.length}
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each data.today as tile (tile.label)}
				<div class="card px-3 py-2">
					<div class="text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">{tile.label}</div>
					<div class="text-lg font-bold tabular-nums text-slate-800">{tile.label.includes('Received') ? '' : tile.value}{#if tile.label.includes('Received')}<Money amount={tile.value} currency={data.tenant.currency} />{/if}</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if !data.whatsapp || data.whatsapp.status !== 'CONNECTED'}
		<div class="flex flex-wrap items-center justify-between gap-2 rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">
			<span>WhatsApp is not connected — traveller acknowledgements and replies are paused.</span>
			<a href="/app/whatsapp" class="font-semibold underline">Connect WhatsApp</a>
		</div>
	{/if}

	<!-- Booking KPIs — only for businesses that book, and only for people watching them -->
	{#if rel('bookings') && showAnalytics}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Requests" value={s.requests.total} hint="{s.requests.last7Days} this week" href="/app/booking-requests" />
		<StatTile label="Pending" value={s.requests.pending} tone="warn" href="/app/booking-requests?status=NEW" />
		<StatTile label="Confirmed" value={s.bookings.confirmed} tone="good" href="/app/bookings?status=CONFIRMED" />
		<StatTile label="Completed" value={s.bookings.completed} href="/app/bookings?status=COMPLETED" />
		<StatTile label="Cancelled" value={s.bookings.cancelled} href="/app/bookings?status=CANCELLED" />
		<StatTile label="Unpaid" value={s.bookings.unpaid} tone={s.bookings.unpaid > 0 ? 'bad' : 'default'} href="/app/bookings?payment=unpaid" />
	</div>
	{/if}

	<div class="grid gap-4 lg:grid-cols-3">
		{#if rel('enquiries')}
		<section class="card lg:col-span-2">
			<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
				<h2 class="text-sm font-semibold text-slate-800">Latest enquiries</h2>
				<a href="/app/booking-requests" class="text-xs text-brand-600 hover:underline">View all</a>
			</header>
			{#if data.recentRequests.length === 0}
				<p class="px-3 py-8 text-center text-xs text-slate-500">No enquiries yet.</p>
			{:else}
				<div>
					<table class="mobile-record-table min-w-full divide-y divide-slate-100">
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
									<td class="table-cell mobile-record-title">
										<a href="/app/booking-requests/{row.request.id}" class="font-medium text-brand-600 hover:underline">{row.request.reference}</a>
										<div class="mt-1 sm:hidden"><StatusBadge value={row.request.status} /></div>
									</td>
									<td class="table-cell" data-label="Traveller">{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || '—'}</td>
									<td class="table-cell mobile-hide" data-label="Status"><StatusBadge value={row.request.status} /></td>
									<td class="table-cell font-semibold" data-label="Value"><Money amount={row.request.estimatedTotal} currency={row.request.currency} /></td>
									<td class="table-cell text-slate-500" data-label="Received"><TimeAgo value={row.request.createdAt} timezone={tz} /></td>
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
									<span class="block truncate text-[12.5px] text-slate-500">{row.conversation.subject ?? row.conversation.channel}</span>
								</span>
								<span class="flex shrink-0 items-center gap-2">
									{#if row.conversation.unreadCount > 0}
										<span class="rounded-full bg-brand-500 px-1.5 text-[11.5px] font-semibold text-white">{row.conversation.unreadCount}</span>
									{/if}
									<span class="text-[12.5px] text-slate-400"><TimeAgo value={row.conversation.lastMessageAt} timezone={tz} /></span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>

	{#if showAnalytics}
		<section class="card">
			<header class="card-header">
				<h2 class="card-title">Activity — last 14 days</h2>
			</header>
			<div class="px-2 pt-2">
				<Chart options={chartOptions} />
			</div>
		</section>
	{/if}

	{#if showAnalytics}
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Customers" value={s.customers.total} hint="{s.customers.last30Days} new in 30 days" href="/app/customers" />
		<StatTile label="Confirmed value" value={s.bookings.confirmedValue.toFixed(0)} hint={data.tenant.currency} />
		<StatTile label="Collected" value={s.payments.collected.toFixed(0)} hint={data.tenant.currency} tone="good" href="/app/payments" />
		<StatTile label="Failed payments" value={s.payments.failed} tone={s.payments.failed > 0 ? 'bad' : 'default'} href="/app/payments?status=FAILED" />
	</div>
	{/if}
</div>
