<script lang="ts">
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import { sourceLabel, statusLabel } from '$lib/labels';
	import { moduleRelevant } from '$lib/workspace';
	import {
		nextForBooking,
		nextForEnquiry,
		nextForOrder,
		nextForQuotation,
		pickNext,
		type NextAction
	} from '$lib/next-action';

	let { data, form } = $props();

	type Record_ = (typeof data.records)[number];

	const caps = $derived(data.tenant.capabilities);
	const rel = (m: Parameters<typeof moduleRelevant>[1]) => moduleRelevant(caps, m);
	const can = (perm: string) => data.permissions?.includes(perm as never) ?? false;
	const name = $derived([data.customer.firstName, data.customer.lastName].filter(Boolean).join(' ') || 'Unnamed traveller');
	const initials = $derived(
		name
			.split(/\s+/)
			.map((part: string) => part[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);

	const ability = $derived({
		orders: can('orders:write'),
		payments: can('payments:write') && data.entitlements?.['payments.enabled'] === true,
		verifyPayments: can('payments:verify'),
		quotations: can('quotations:write') && data.entitlements?.['quotations.enabled'] === true,
		bookings: can('bookings:read'),
		bookingsWrite: can('bookings:write'),
		trips: can('trips:read'),
		tripsWrite: can('trips:write')
	});

	/** Only the kinds this business actually runs on ever reach the page. */
	const KIND_MODULE: Record<string, Parameters<typeof moduleRelevant>[1]> = {
		enquiry: 'enquiries',
		quotation: 'quotations',
		booking: 'bookings',
		order: 'orders'
	};
	const records = $derived(data.records.filter((r: Record_) => rel(KIND_MODULE[r.kind])));
	const outstandingOf = (r: Record_) => Math.max(0, Number(r.total) - Number(r.amount_paid));

	/** A request still in flight against this record — drives the money-first rules. */
	const requestFor = (r: Record_) =>
		data.requests.find(
			(q: (typeof data.requests)[number]) =>
				['REQUESTED', 'REPORTED', 'PARTIALLY_PAID'].includes(q.status) &&
				(q.orderId === r.id || q.bookingId === r.id)
		) ?? null;

	const hasQuotation = $derived(records.some((r: Record_) => r.kind === 'quotation'));

	/** The same precedence the order screen, the thread and the payments queue use. */
	const actionFor = (r: Record_): NextAction | null => {
		const activeRequestStatus = requestFor(r)?.status ?? null;
		if (r.kind === 'order') return nextForOrder({ id: r.id, status: r.status, outstanding: outstandingOf(r), activeRequestStatus }, ability);
		if (r.kind === 'booking') return nextForBooking({ id: r.id, status: r.status, outstanding: outstandingOf(r), activeRequestStatus }, ability);
		if (r.kind === 'quotation') return nextForQuotation({ id: r.id, status: r.status, convertedBookingId: r.converted_booking_id }, ability);
		return nextForEnquiry({ id: r.id, status: r.status, hasQuotation }, ability);
	};

	const nextAction = $derived(pickNext(records.map(actionFor)));

	// The journey we show is the one that needs something. Failing that, the one they
	// touched most recently — records already arrive newest-first.
	const leadRecord = $derived(
		records.find((r: Record_) => actionFor(r)?.key === nextAction?.key && Boolean(nextAction)) ?? records[0] ?? null
	);

	const latest = (kind: string) => records.find((r: Record_) => r.kind === kind) ?? null;

	type Stage = { label: string; state: 'done' | 'now' | 'todo'; href?: string; note?: string };

	/** Business language, not a workflow diagram: four stages, each either done, now or ahead. */
	const journey = $derived.by((): { title: string; stages: Stage[] } | null => {
		if (!leadRecord) return null;
		const paidUp = (r: Record_ | null) => Boolean(r) && outstandingOf(r!) <= 0;

		if (leadRecord.kind === 'order') {
			const order = leadRecord;
			const request = requestFor(order);
			return {
				title: `Order ${order.reference}`,
				stages: [
					{ label: 'Order placed', state: 'done', href: `/app/orders/${order.id}`, note: statusLabel(order.status) },
					{
						label: 'Confirmed',
						state: ['DRAFT', 'PENDING_CONFIRMATION'].includes(order.status) ? 'now' : 'done'
					},
					{
						label: 'Paid',
						state: paidUp(order) ? 'done' : request ? 'now' : 'todo',
						note: request ? statusLabel(request.status) : undefined
					},
					{
						label: 'Delivered',
						state: order.status === 'DELIVERED' ? 'done' : ['READY', 'DISPATCHED'].includes(order.status) ? 'now' : 'todo',
						note: ['READY', 'DISPATCHED'].includes(order.status) ? statusLabel(order.status) : undefined
					}
				]
			};
		}

		const enquiry = latest('enquiry');
		const quote = latest('quotation');
		const booking = latest('booking');
		const request = booking ? requestFor(booking) : null;
		return {
			title: booking ? `Booking ${booking.reference}` : quote ? `Quotation ${quote.reference}` : enquiry ? `Enquiry ${enquiry.reference}` : 'This traveller',
			stages: [
				{
					label: 'Enquiry',
					state: enquiry ? 'done' : 'todo',
					href: enquiry ? `/app/booking-requests/${enquiry.id}` : undefined,
					note: enquiry ? statusLabel(enquiry.status) : undefined
				},
				{
					label: 'Quotation',
					state: quote ? (['DRAFT'].includes(quote.status) ? 'now' : 'done') : enquiry ? 'now' : 'todo',
					href: quote ? `/app/quotations/${quote.id}` : undefined,
					note: quote ? statusLabel(quote.status) : undefined
				},
				{
					label: 'Payment',
					state: booking && paidUp(booking) ? 'done' : request ? 'now' : 'todo',
					note: request ? statusLabel(request.status) : undefined
				},
				{
					label: 'Booking',
					state: booking
						? ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status)
							? 'done'
							: 'now'
						: 'todo',
					href: booking ? `/app/bookings/${booking.id}` : undefined,
					note: booking ? statusLabel(booking.status) : undefined
				}
			]
		};
	});

	/** Never add up two currencies — group, or say nothing. */
	const owed = $derived.by(() => {
		const totals = new Map<string, number>();
		for (const r of records) {
			if (r.kind === 'enquiry' || r.kind === 'quotation') continue;
			const amount = outstandingOf(r);
			if (amount > 0) totals.set(r.currency, (totals.get(r.currency) ?? 0) + amount);
		}
		return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
	});

	const lastPayment = $derived(data.payments[0] ?? null);

	// A timeline built from what we already loaded — no audit rows, no extra queries.
	type Event = { at: string | Date; text: string; href?: string };
	const timeline = $derived.by(() => {
		const events: Event[] = [];
		for (const r of records) {
			const label =
				r.kind === 'enquiry'
					? `Enquiry ${r.reference} received`
					: r.kind === 'quotation'
						? `Quotation ${r.reference} created`
						: r.kind === 'booking'
							? `Booking ${r.reference} created`
							: `Order ${r.reference} placed`;
			const href =
				r.kind === 'enquiry'
					? `/app/booking-requests/${r.id}`
					: r.kind === 'quotation'
						? `/app/quotations/${r.id}`
						: r.kind === 'booking'
							? `/app/bookings/${r.id}`
							: `/app/orders/${r.id}`;
			events.push({ at: r.created_at, text: label, href });
			if (r.updated_at !== r.created_at) {
				events.push({ at: r.updated_at, text: `${label.split(' ').slice(0, 2).join(' ')} — ${statusLabel(r.status)}`, href });
			}
		}
		for (const q of data.requests) {
			events.push({ at: q.createdAt, text: `Payment requested — ${q.currency} ${Number(q.amountRequested).toLocaleString()}` });
			if (q.reportedAt) events.push({ at: q.reportedAt, text: 'Customer said they had paid' });
		}
		for (const p of data.payments) {
			events.push({ at: p.createdAt, text: `Payment received — ${p.currency} ${Number(p.amount).toLocaleString()}` });
		}
		for (const c of data.conversations) {
			if (c.lastMessageAt) events.push({ at: c.lastMessageAt, text: 'Message on WhatsApp', href: `/app/conversations/${c.id}` });
		}
		return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
	});

	const grouped = $derived({
		enquiry: records.filter((r: Record_) => r.kind === 'enquiry'),
		quotation: records.filter((r: Record_) => r.kind === 'quotation'),
		booking: records.filter((r: Record_) => r.kind === 'booking'),
		order: records.filter((r: Record_) => r.kind === 'order')
	});
	const SECTIONS = $derived(
		[
			{ kind: 'order', title: 'Orders', href: '/app/orders', base: '/app/orders' },
			{ kind: 'enquiry', title: 'Enquiries', href: '/app/booking-requests', base: '/app/booking-requests' },
			{ kind: 'quotation', title: 'Quotations', href: '/app/quotations', base: '/app/quotations' },
			{ kind: 'booking', title: 'Bookings', href: '/app/bookings', base: '/app/bookings' }
		].filter((s) => grouped[s.kind as keyof typeof grouped].length > 0)
	);

	let showMore = $state(false);
	let showNote = $state(false);
	const primaryConversation = $derived(data.conversations[0] ?? null);
</script>

<svelte:head><title>{name} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Saved" />

<div class="mx-auto max-w-3xl space-y-3">
	<a href="/app/customers" class="text-xs text-slate-500 hover:underline">← Travellers</a>

	<!-- Who is this? Identity and the one action, nothing technical. -->
	<header class="card p-4">
		<div class="flex items-start gap-3">
			<span class="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">{initials}</span>
			<div class="min-w-0 flex-1">
				<h1 class="truncate text-lg font-bold tracking-tight text-slate-900">{name}</h1>
				<p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-500">
					{#if data.customer.whatsappPhone}<span>+{data.customer.whatsappPhone}</span>{/if}
					{#if data.customer.email}<span class="truncate">{data.customer.email}</span>{/if}
					<span class="text-slate-400">{sourceLabel(data.customer.source)}</span>
				</p>
			</div>
		</div>

		<div class="mt-3 flex flex-wrap gap-2">
			{#if primaryConversation}
				<a href="/app/conversations/{primaryConversation.id}" class={nextAction ? 'btn-secondary' : 'btn-primary'}>Open conversation</a>
			{/if}
			<button class="btn-secondary" onclick={() => (showMore = !showMore)}>{showMore ? 'Fewer actions' : 'More'}</button>
		</div>

		{#if showMore}
			<div class="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
				{#if rel('enquiries') && can('booking_requests:write')}
					<a href="/app/booking-requests/new" class="btn-secondary !py-1.5 text-xs">Log an enquiry</a>
				{/if}
				{#if rel('orders') && can('orders:write') && data.entitlements?.['orders.enabled'] === true}
					<a href="/app/orders/new" class="btn-secondary !py-1.5 text-xs">New order</a>
				{/if}
				{#if can('customers:write')}
					<button class="btn-secondary !py-1.5 text-xs" onclick={() => { showNote = !showNote; showMore = false; }}>Add a note</button>
				{/if}
			</div>
		{/if}

		{#if showNote && can('customers:write')}
			<form method="POST" action="?/note" use:enhance class="mt-3 space-y-2 border-t border-slate-100 pt-3">
				<label class="label" for="c-notes">Note</label>
				<textarea id="c-notes" name="notes" rows="3" class="input" placeholder="Prefers WhatsApp voice notes. Travelling with two children.">{data.customer.notes ?? ''}</textarea>
				<div class="flex justify-end gap-2">
					<button type="button" class="btn-secondary" onclick={() => (showNote = false)}>Cancel</button>
					<button class="btn-primary">Save note</button>
				</div>
			</form>
		{:else if data.customer.notes}
			<p class="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">{data.customer.notes}</p>
		{/if}
	</header>

	<!-- What needs doing. One action, and only when there is one. -->
	{#if nextAction}
		<section class="rounded-panel border border-brand-200 bg-brand-50/50 p-4">
			<p class="text-[11px] font-bold tracking-[0.12em] text-brand-700 uppercase">Needs you</p>
			<p class="mt-1.5 text-sm text-slate-700">{nextAction.hint ?? 'This customer is waiting on the next step.'}</p>
			<a href={nextAction.href} class="btn-primary mt-3">{nextAction.label}</a>
		</section>
	{/if}

	<!-- Where they are in the journey. -->
	{#if journey}
		<section class="card p-4">
			<div class="flex items-baseline justify-between gap-2">
				<h2 class="text-sm font-semibold text-slate-800">{journey.title}</h2>
				{#if owed.length}
					<span class="text-[13px] font-semibold text-[#b58514]">
						Owes {#each owed as o, i (o.currency)}{i ? ' · ' : ''}<Money amount={o.amount.toFixed(2)} currency={o.currency} />{/each}
					</span>
				{/if}
			</div>
			<ol class="mt-3 grid gap-2 sm:grid-cols-4">
				{#each journey.stages as stage (stage.label)}
					<li class="rounded-xl border p-3 {stage.state === 'now' ? 'border-brand-300 bg-brand-50/60' : stage.state === 'done' ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50/60'}">
						<p class="flex items-center gap-1.5 text-[13px] font-semibold {stage.state === 'todo' ? 'text-slate-400' : 'text-slate-800'}">
							{#if stage.state === 'done'}<span class="text-success">✓</span>{/if}
							{stage.label}
						</p>
						{#if stage.note}<p class="mt-0.5 truncate text-[11.5px] text-slate-500">{stage.note}</p>{/if}
						{#if stage.href}<a href={stage.href} class="mt-1 inline-block text-[11.5px] font-medium text-brand-600 hover:underline">Open</a>{/if}
					</li>
				{/each}
			</ol>
			{#if lastPayment}
				<p class="mt-3 border-t border-slate-100 pt-3 text-[12.5px] text-slate-500">
					Last payment <Money amount={lastPayment.amount} currency={lastPayment.currency} /> · {statusLabel(lastPayment.status)} ·
					<TimeAgo value={lastPayment.createdAt} timezone={data.tenant.timezone} />
				</p>
			{/if}
		</section>
	{/if}

	<!-- What has happened, in words. -->
	{#if timeline.length}
		<section class="card p-4">
			<h2 class="text-sm font-semibold text-slate-800">Recent activity</h2>
			<ul class="mt-2 space-y-2">
				{#each timeline as event (String(event.at) + event.text)}
					<li class="flex items-baseline gap-2.5 text-[13px]">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300"></span>
						<span class="min-w-0 flex-1 text-slate-600">
							{#if event.href}<a href={event.href} class="hover:underline">{event.text}</a>{:else}{event.text}{/if}
						</span>
						<span class="shrink-0 text-[11.5px] text-slate-400"><TimeAgo value={event.at} timezone={data.tenant.timezone} /></span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Everything else, compact and only what this business runs on. -->
	{#each SECTIONS as section (section.kind)}
		{@const rows = grouped[section.kind as keyof typeof grouped]}
		<section class="card p-4">
			<div class="flex items-baseline justify-between">
				<h2 class="text-sm font-semibold text-slate-800">{section.title}</h2>
				{#if rows.length > 3}<a href={section.href} class="text-xs text-brand-600 hover:underline">View all</a>{/if}
			</div>
			<ul class="mt-2 divide-y divide-slate-100">
				{#each rows.slice(0, 3) as row (row.id)}
					<li>
						<a href="{section.base}/{row.id}" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 hover:bg-slate-50">
							<span class="font-mono text-[12.5px] font-medium text-slate-700">{row.reference}</span>
							<StatusBadge value={row.status} size="xs" />
							{#if Number(row.total) > 0}
								<span class="text-[13px] tabular-nums text-slate-600"><Money amount={row.total} currency={row.currency} /></span>
							{/if}
							<span class="ml-auto text-[11.5px] text-slate-400"><TimeAgo value={row.updated_at} timezone={data.tenant.timezone} /></span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if data.conversations.length}
		<section class="card p-4">
			<h2 class="text-sm font-semibold text-slate-800">Conversations</h2>
			<ul class="mt-2 divide-y divide-slate-100">
				{#each data.conversations as conversation (conversation.id)}
					<li>
						<a href="/app/conversations/{conversation.id}" class="flex items-center gap-3 py-2.5 hover:bg-slate-50">
							<span class="text-[13px] text-slate-700">{conversation.channel === 'WHATSAPP' ? 'WhatsApp' : conversation.channel}</span>
							{#if conversation.unreadCount > 0}
								<span class="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-white">{conversation.unreadCount}</span>
							{/if}
							<span class="ml-auto text-[11.5px] text-slate-400"><TimeAgo value={conversation.lastMessageAt} timezone={data.tenant.timezone} /></span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if !records.length && !data.conversations.length}
		<section class="card p-8 text-center">
			<p class="text-sm font-medium text-slate-700">Nothing has happened yet</p>
			<p class="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-slate-500">
				When {name} messages you on WhatsApp, sends an enquiry or places an order, it will all appear here as one story.
			</p>
		</section>
	{/if}
</div>
