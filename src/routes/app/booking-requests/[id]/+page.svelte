<script lang="ts">
	import { page } from '$app/state';
	import { statusLabel } from '$lib/labels';
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	/** The enquiry journey as buttons; the select survives only as a quiet fallback. */
	const FORWARD: Record<string, Array<{ to: string; label: string }>> = {
		NEW: [{ to: 'CONTACTED', label: 'Mark contacted' }],
		UNDER_REVIEW: [{ to: 'CONTACTED', label: 'Mark contacted' }],
		QUOTED: [{ to: 'ACCEPTED', label: 'Mark accepted' }],
		ACCEPTED: []
	};
	const forward = $derived(FORWARD[data.request.status] ?? []);
	const canQuote = $derived(
		data.permissions?.includes('quotations:write') &&
			data.entitlements?.['quotations.enabled'] === true &&
			['NEW', 'UNDER_REVIEW', 'CONTACTED'].includes(data.request.status)
	);
	let moreStatus = $state(false);

	/*
	 * The quotation composer, mirroring the phone sheet field for field.
	 *
	 * Same draft, same words, same order: an operator who prices a trip on the
	 * phone in the morning should not meet a different form in the afternoon.
	 * The heavy lifting — which tour, what it costs, per person or per group —
	 * came from the server in `data.quoteDraft`, which is the SAME function the
	 * mobile endpoint calls.
	 */
	let composing = $state(false);
	let showDetails = $state(false);
	let adults = $state(1);
	let children = $state(0);
	let adultPrice = $state('');
	let childPrice = $state('');
	let childPriceEdited = $state(false);
	let quoteTitle = $state('');
	let quoteMessage = $state('');
	let quoteIncluded = $state('');
	let validUntil = $state('');

	const draft = $derived(data.quoteDraft);
	const perGroup = $derived(draft?.items?.[0]?.basis === 'per group');
	const publishedPrice = $derived(Number(draft?.items?.[0]?.unitPrice ?? 0) || null);
	const quoteCurrency = $derived(draft?.currency ?? data.request.currency ?? 'USD');

	function openComposer() {
		const d = data.quoteDraft;
		adults = d?.enquiry.adults ?? 1;
		children = d?.enquiry.children ?? 0;
		const opening = publishedPrice ? String(publishedPrice) : '';
		adultPrice = opening;
		childPrice = opening;
		childPriceEdited = false;
		quoteTitle = d?.tour?.title ?? '';
		quoteMessage = '';
		quoteIncluded = '';
		validUntil = '';
		showDetails = false;
		composing = true;
	}

	const step = (value: number, by: number) => Math.max(0, Math.min(40, value + by));
	const num = (raw: string) => Number(String(raw).replace(/[,\s]/g, '')) || 0;

	const travellers = $derived(adults + children);
	const quoteTotal = $derived(
		perGroup ? num(adultPrice) : adults * num(adultPrice) + children * num(childPrice)
	);
	const canSubmitQuote = $derived(
		(quoteTitle.trim().length > 0 || (draft?.tour?.title ?? '').length > 0) && travellers > 0 && quoteTotal > 0
	);

	const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	/** "15 Sep", or "15 Sep – 21 Sep" when the enquiry gave both ends. */
	const shortDay = (value: unknown) => {
		const date = value ? new Date(String(value)) : null;
		return date && !Number.isNaN(date.getTime())
			? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz })
			: null;
	};
	const travelWindow = $derived.by(() => {
		const from = shortDay(data.request.startDate);
		if (!from) return null;
		const to = shortDay(data.request.endDate);
		return to ? `${from} – ${to}` : from;
	});
	const amount = (value: number) =>
		`${quoteCurrency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`;
	const basisLine = $derived(
		perGroup
			? ['Whole group', people(adults, 'adult', 'adults'), ...(children ? [people(children, 'child', 'children')] : [])].join(' · ')
			: [
					...(adults > 0 ? [`${people(adults, 'adult', 'adults')} × ${amount(num(adultPrice))}`] : []),
					...(children > 0 ? [`${people(children, 'child', 'children')} × ${amount(num(childPrice))}`] : [])
				].join('  +  ')
	);
	const STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED'];
	const tz = $derived(data.tenant.timezone);
	const canWrite = $derived(data.permissions?.includes('booking_requests:write'));
	const canSend = $derived(data.permissions?.includes('whatsapp:send'));
	const traveller = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || 'Unknown traveller');
</script>

<svelte:head><title>{data.request.reference} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Saved" />

<!-- Created just now: say what happened, then hand over the next move rather than
     leaving a green tick and a page the operator has to interpret. -->
{#if page.url.searchParams.get('created') === '1'}
	<div class="mb-3 flex flex-wrap items-center gap-2 rounded-panel border border-success/25 bg-success/5 px-4 py-3">
		<span class="text-sm font-semibold text-slate-800">Enquiry created</span>
		<span class="text-[13px] text-slate-500">What next?</span>
		<div class="ml-auto flex flex-wrap gap-1.5">
			{#if canQuote}
				<button class="btn-primary !py-1.5 text-xs" onclick={openComposer}>Create quotation</button>
			{/if}
			{#if data.request.conversationId}
				<a href="/app/conversations/{data.request.conversationId}" class="btn-secondary !py-1.5 text-xs">Reply on WhatsApp</a>
			{/if}
		</div>
	</div>
{/if}

<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/booking-requests" class="text-xs text-slate-500 hover:underline">← Enquiries</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">
				{data.request.reference}
				<StatusBadge value={data.request.status} />
			</h1>
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			{#if canQuote}
				<button class="btn-primary" onclick={openComposer}>Create quotation</button>
			{/if}
			{#if canWrite}
				{#each forward as move (move.to)}
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="status" value={move.to} />
						<button class="btn-secondary">{move.label}</button>
					</form>
				{/each}
				<button class="text-[12.5px] text-slate-400 hover:underline" onclick={() => (moreStatus = !moreStatus)}>More…</button>
			{/if}
		</div>
	</div>

	<!--
		The quotation composer — the phone sheet, on a wider screen.

		Deliberately the same six things in the same order: who and what, the
		party, the price, the total, a message, and everything else folded behind
		"Add details". A quotation raised here and one raised on the phone are the
		same quotation, because both are built from `draftQuotationFor`.
	-->
	{#if composing && draft}
		<form method="POST" action="?/createQuote" use:enhance class="card space-y-4 p-4">
			<div>
				<div class="flex items-start justify-between gap-3">
					<h2 class="text-base font-semibold text-slate-900">Create quotation</h2>
					<button type="button" class="text-[12.5px] text-slate-400 hover:underline" onclick={() => (composing = false)}>Cancel</button>
				</div>
				<p class="mt-2 text-sm font-medium text-slate-800">{traveller}</p>
				{#if draft.tour?.title}<p class="text-[13px] text-slate-500">{draft.tour.title}</p>{/if}
				<p class="text-[12.5px] text-slate-500">
					{#if travelWindow}{travelWindow} · {/if}{people(travellers, 'traveller', 'travellers')}
				</p>
			</div>

			{#if !draft.tour?.title}
				<label class="block">
					<span class="text-[12.5px] font-medium text-slate-500">What you are quoting for</span>
					<input name="title" bind:value={quoteTitle} class="input mt-1" placeholder="Trip" />
				</label>
			{/if}

			<div class="border-t border-slate-100 pt-4">
				<p class="text-[11px] font-bold tracking-wider text-slate-500 uppercase">Travellers</p>
				<div class="mt-2 grid max-w-sm gap-2">
					<div class="flex items-center justify-between">
						<span class="text-sm text-slate-700">Adults</span>
						<span class="flex items-center gap-1">
							<button type="button" class="btn-secondary !px-3 !py-1" onclick={() => (adults = step(adults, -1))} aria-label="One adult fewer">−</button>
							<span class="w-10 text-center text-base font-bold tabular-nums">{adults}</span>
							<button type="button" class="btn-secondary !px-3 !py-1" onclick={() => (adults = step(adults, 1))} aria-label="One adult more">+</button>
						</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-sm text-slate-700">Children</span>
						<span class="flex items-center gap-1">
							<button type="button" class="btn-secondary !px-3 !py-1" onclick={() => (children = step(children, -1))} aria-label="One child fewer">−</button>
							<span class="w-10 text-center text-base font-bold tabular-nums">{children}</span>
							<button type="button" class="btn-secondary !px-3 !py-1" onclick={() => (children = step(children, 1))} aria-label="One child more">+</button>
						</span>
					</div>
				</div>
				<input type="hidden" name="adults" value={adults} />
				<input type="hidden" name="children" value={children} />
			</div>

			<div class="border-t border-slate-100 pt-4">
				<p class="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
					{perGroup ? 'Price for the group' : 'Price per person'}
				</p>
				<!-- Published is information, so it is printed, not boxed: quoting is
				     not editing the listing, and this figure never changes here. -->
				<p class="mt-2 text-[13px] text-slate-500">
					Published <span class="ml-1 font-semibold text-slate-800">{publishedPrice ? amount(publishedPrice) : 'Not set'}</span>
				</p>
				<div class="mt-2 grid max-w-md gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="text-[12.5px] text-slate-500">{perGroup || children === 0 ? 'Your quote' : 'Adults'}</span>
						<div class="mt-1 flex items-center gap-2">
							<span class="text-[12.5px] text-slate-400">{quoteCurrency}</span>
							<input
								name="adultPrice"
								inputmode="decimal"
								bind:value={adultPrice}
								oninput={() => { if (!childPriceEdited) childPrice = adultPrice; }}
								class="input font-semibold"
								placeholder="0"
							/>
						</div>
					</label>
					{#if children > 0 && !perGroup}
						<!-- Opens at the adult rate. No child discount is invented: no
						     tour in this catalogue publishes one, so it is the
						     operator's call. -->
						<label class="block">
							<span class="text-[12.5px] text-slate-500">Children</span>
							<div class="mt-1 flex items-center gap-2">
								<span class="text-[12.5px] text-slate-400">{quoteCurrency}</span>
								<input
									name="childPrice"
									inputmode="decimal"
									bind:value={childPrice}
									oninput={() => (childPriceEdited = true)}
									class="input font-semibold"
									placeholder="0"
								/>
							</div>
						</label>
					{/if}
				</div>
			</div>

			<div class="rounded-panel bg-brand/8 px-4 py-3">
				<p class="text-[11px] font-bold tracking-wider text-brand uppercase">Total</p>
				<p class="text-2xl font-bold text-slate-900">{quoteTotal > 0 ? amount(quoteTotal) : '—'}</p>
				{#if quoteTotal > 0}<p class="text-[12.5px] text-slate-500">{basisLine}</p>{/if}
			</div>

			<label class="block">
				<span class="text-[12.5px] text-slate-500">Message to traveller (optional)</span>
				<textarea name="message" bind:value={quoteMessage} rows="2" class="input mt-1" placeholder="Add a short message…"></textarea>
			</label>

			{#if !showDetails}
				<button type="button" class="text-[13px] font-medium text-brand hover:underline" onclick={() => (showDetails = true)}>+ Add details</button>
			{:else}
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="block">
						<span class="text-[12.5px] text-slate-500">Valid until</span>
						<input type="date" name="validUntil" bind:value={validUntil} class="input mt-1" />
					</label>
					<label class="block">
						<span class="text-[12.5px] text-slate-500">What's included (optional)</span>
						<input name="included" bind:value={quoteIncluded} class="input mt-1" placeholder="Park fees, lodging, transport…" />
					</label>
				</div>
			{/if}

			<div class="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
				<button name="send" value="0" class="btn-secondary" disabled={!canSubmitQuote}>Save draft</button>
				<button name="send" value="1" class="btn-primary" disabled={!canSubmitQuote}>Send quotation</button>
			</div>
		</form>
	{/if}

	{#if canWrite && moreStatus}
		<form method="POST" action="?/status" use:enhance class="flex justify-end gap-2">
			<select name="status" class="input w-auto !py-1.5 text-xs">
				{#each STATUSES as s (s)}
					<option value={s} selected={data.request.status === s}>{statusLabel(s)}</option>
				{/each}
			</select>
			<button class="btn-secondary !py-1.5 text-xs">Update</button>
		</form>
	{/if}

	{#if form?.message}
		<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
	{/if}

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Trip</header>
				<dl class="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-4">
					<div><dt class="text-[12.5px] uppercase text-slate-500">Start</dt><dd>{data.request.startDate ? new Date(data.request.startDate).toLocaleDateString('en-GB', { timeZone: tz }) : '—'}</dd></div>
					<div><dt class="text-[12.5px] uppercase text-slate-500">End</dt><dd>{data.request.endDate ? new Date(data.request.endDate).toLocaleDateString('en-GB', { timeZone: tz }) : '—'}</dd></div>
					<div><dt class="text-[12.5px] uppercase text-slate-500">Travellers</dt><dd class="tabular-nums">{data.request.adults} adults · {data.request.children} children</dd></div>
					<div><dt class="text-[12.5px] uppercase text-slate-500">Estimated</dt><dd><Money amount={data.request.estimatedTotal} currency={data.request.currency} /></dd></div>
					{#if data.request.externalReference}
						<div class="col-span-2">
							<dt class="text-[12.5px] uppercase text-slate-500">Client catalog reference</dt>
							<dd class="font-mono text-xs">{data.request.externalSource ?? 'external'}:{data.request.externalReference}</dd>
						</div>
					{/if}
					{#if data.request.notes}
						<div class="col-span-full"><dt class="text-[12.5px] uppercase text-slate-500">Notes</dt><dd class="whitespace-pre-wrap text-slate-700">{data.request.notes}</dd></div>
					{/if}
				</dl>
			</section>

			{#if data.items.length}
				<section class="card">
					<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Requested items</header>
					<table class="mobile-record-table min-w-full divide-y divide-slate-100">
						<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Qty</th><th class="table-head">Total</th></tr></thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.items as item (item.id)}
								<tr>
									<td class="table-cell mobile-record-title">
										<div class="font-medium text-slate-800">{item.title}</div>
										{#if item.description}<div class="text-[12.5px] text-slate-500">{item.description}</div>{/if}
									</td>
									<td class="table-cell text-[12.5px] uppercase text-slate-500" data-label="Type">{item.type}</td>
									<td class="table-cell tabular-nums" data-label="Quantity">{item.quantity}</td>
									<td class="table-cell font-semibold" data-label="Total"><Money amount={item.total ?? item.unitPrice} currency={data.request.currency} /></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

			{#if data.travelers.length}
				<section class="card">
					<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
						<h2 class="text-sm font-semibold text-slate-800">Travellers</h2>
						{#if !data.canSeeSensitive}<span class="text-[12.5px] text-slate-400">Passport details hidden for your role</span>{/if}
					</header>
					<table class="mobile-record-table min-w-full divide-y divide-slate-100">
						<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Nationality</th><th class="table-head">Passport</th><th class="table-head">Requests</th></tr></thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.travelers as t (t.id)}
								<tr>
									<td class="table-cell mobile-record-title font-semibold">{[t.firstName, t.lastName].filter(Boolean).join(' ') || '—'}</td>
									<td class="table-cell" data-label="Nationality">{t.nationality ?? '—'}</td>
									<td class="table-cell font-mono text-xs" data-label="Passport">{t.passportNumber ?? '••••••'}</td>
									<td class="table-cell text-[12.5px] text-slate-500" data-label="Requests">{t.specialRequests ?? t.dietaryRequirements ?? '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

			<!-- §17: the conversation sits beside the request, not in a separate search. -->
			<section class="card">
				<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
					<h2 class="text-sm font-semibold text-slate-800">WhatsApp conversation</h2>
					{#if data.request.conversationId}
						<a href="/app/conversations/{data.request.conversationId}" class="text-xs text-brand-600 hover:underline">Open thread</a>
					{/if}
				</header>
				{#if data.messages.length === 0}
					<p class="px-3 py-6 text-center text-xs text-slate-500">No messages yet.</p>
				{:else}
					<ul class="max-h-80 space-y-2 overflow-y-auto p-3">
						{#each data.messages as m (m.id)}
							<li class="flex {m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}">
								<div class="max-w-[80%] rounded-lg px-3 py-1.5 text-sm {m.direction === 'OUTBOUND' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-800'}">
									<p class="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</p>
									<p class="mt-0.5 text-[11.5px] {m.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400'}">
										<TimeAgo value={m.createdAt} timezone={tz} /> · {m.status.toLowerCase()}
									</p>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if canSend}
					<form method="POST" action="?/reply" use:enhance class="flex gap-2 border-t border-slate-200 p-2">
						<input name="text" placeholder="Reply on WhatsApp…" class="input" />
						<button class="btn-primary">Send</button>
					</form>
				{/if}
			</section>
		</div>

		<div class="space-y-3">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Traveller</header>
				<div class="space-y-1 p-3 text-sm">
					<div class="font-medium text-slate-900">{traveller}</div>
					{#if data.customer?.email}<div class="text-slate-600">{data.customer.email}</div>{/if}
					{#if data.customer?.whatsappPhone}<div class="text-slate-600">+{data.customer.whatsappPhone}</div>{/if}
					{#if data.customer?.country}<div class="text-[12.5px] uppercase text-slate-500">{data.customer.country}</div>{/if}
					{#if data.customer}
						<a href="/app/customers/{data.customer.id}" class="mt-2 inline-block text-xs text-brand-600 hover:underline">Customer record →</a>
					{/if}
				</div>
			</section>

			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Internal notes</header>
				{#if canWrite}
					<form method="POST" action="?/note" use:enhance class="space-y-2 border-b border-slate-100 p-3">
						<textarea name="body" rows="2" placeholder="Add a note…" class="input"></textarea>
						<button class="btn-secondary w-full">Add note</button>
					</form>
				{/if}
				<ul class="divide-y divide-slate-100">
					{#each data.notes as note (note.id)}
						<li class="px-3 py-2">
							<p class="whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
							<p class="mt-0.5 text-[12.5px] text-slate-400"><TimeAgo value={note.createdAt} timezone={tz} /></p>
						</li>
					{:else}
						<li class="px-3 py-6 text-center text-xs text-slate-500">No notes yet.</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>
