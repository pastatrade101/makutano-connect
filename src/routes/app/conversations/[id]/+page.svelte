<script lang="ts">
	import { messagePreview } from '$lib/labels';
	import { moduleRelevant } from '$lib/workspace';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	// Reback chat thread: header with avatar + context, bubbles with delivery ticks
	// (✓ sent, ✓✓ delivered, ✓✓ tinted read), composer pinned at the bottom.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	// AI assist: every suggestion is a DRAFT held in the page until a human commits.
	let suggestingFor = $state<string | null>(null);
	let busyAction = $state<string | null>(null);
	const primaryAiAction = $derived((data.aiActions ?? []).find((a) => a.primary) ?? null);
	const enquiry = $derived(form?.enquiry ?? null);
	const replyDraft = $derived(form?.replyDraft ?? null);
	const summary = $derived(form?.summary ?? null);
	// Edits are tracked so the acceptance metric can tell "took it as-is" from
	// "fixed it first" — the difference between a useful draft and a nuisance.
	let enquiryEdited = $state(false);
	let replyEdited = $state(false);
	let replyText = $state('');
	$effect(() => {
		if (replyDraft) { replyText = replyDraft.reply; replyEdited = false; }
	});
	const INTENT_LABEL: Record<string, string> = {
		NEW_TRIP_ENQUIRY: 'a new trip enquiry',
		EXISTING_BOOKING_QUESTION: 'a question about an existing booking',
		PRICE_QUESTION: 'a price question',
		AVAILABILITY_QUESTION: 'an availability question',
		ITINERARY_QUESTION: 'an itinerary question',
		PAYMENT_CLAIM: 'a payment claim — verify it before marking anything paid',
		PAYMENT_QUESTION: 'a payment question',
		CHANGE_REQUEST: 'a booking change request',
		CANCELLATION_REQUEST: 'a cancellation request',
		COMPLAINT: 'a complaint',
		GENERAL_QUESTION: 'a general question',
		OTHER: 'something else'
	};
	const enquiryNotesText = $derived(enquiry?.notes ?? '');
	const suggestion = $derived(form?.suggestion ?? null);
	let draftLines = $state<Array<{ title: string; quantity: number; unit: string | null; unitPrice: string | null }>>([]);
	let draftMethod = $state('');
	let draftLocation = $state('');
	$effect(() => {
		if (!suggestion) return;
		draftLines = suggestion.lines.map((l) => ({ ...l }));
		draftMethod = suggestion.draft.deliveryMethod ?? '';
		draftLocation = suggestion.draft.deliveryLocation ?? '';
	});

	const canSend = $derived(data.permissions?.includes('whatsapp:send'));
	const who = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || `+${data.conversation.externalId ?? ''}`);
	const initials = $derived(who.replace(/^\+/, '').split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase() || '#');

	const KIND_HREF: Record<string, string> = { order: '/app/orders', booking: '/app/bookings', quotation: '/app/quotations' };
	let showContext = $state(false);
	let batchQty = $state('');
	let others = $state<Array<{ name: string; typing: boolean }>>([]);
	let composerText = $state('');
	let typingUntil = 0;

	async function beat() {
		try {
			const res = await fetch(`/app/conversations/${page.params.id}/presence`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ typing: Date.now() < typingUntil })
			});
			if (res.ok) others = (await res.json()).others ?? [];
		} catch {
			/* presence is best-effort */
		}
	}
	onMount(() => {
		void beat();
		const interval = setInterval(beat, 8000);
		return () => clearInterval(interval);
	});
	const presenceLine = $derived.by(() => {
		if (!others.length) return null;
		const typing = others.filter((o) => o.typing).map((o) => o.name);
		const viewing = others.filter((o) => !o.typing).map((o) => o.name);
		const parts: string[] = [];
		if (typing.length) parts.push(`${typing.join(', ')} ${typing.length === 1 ? 'is' : 'are'} typing…`);
		if (viewing.length) parts.push(`${viewing.join(', ')} ${viewing.length === 1 ? 'is' : 'are'} viewing`);
		return parts.join(' · ');
	});
	const canOrder = $derived(
		moduleRelevant(data.tenant.capabilities, 'orders') && data.permissions?.includes('orders:write') && !!data.customer
	);

	const TICKS: Record<string, { marks: number; tinted: boolean }> = {
		QUEUED: { marks: 0, tinted: false },
		SENT: { marks: 1, tinted: false },
		DELIVERED: { marks: 2, tinted: false },
		READ: { marks: 2, tinted: true },
		FAILED: { marks: 0, tinted: false }
	};
</script>

<svelte:head><title>{who} · Inbox</title></svelte:head>

<FormToast {form} successTitle="Message sent" />

<header class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
	<div class="flex min-w-0 items-center gap-3">
		<a href="/app/conversations" class="rounded-panel p-1 text-slate-400 hover:bg-slate-100 lg:hidden" aria-label="Back to inbox">
			<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4 6 10l6 6" /></svg>
		</a>
		<div class="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-600">{initials}</div>
		<div class="min-w-0">
			<h1 class="truncate text-[14px] font-semibold text-slate-700">{who}</h1>
			<p class="truncate text-[11px] text-slate-400">
				{#if presenceLine}
					<span class="font-medium text-brand-600">{presenceLine}</span>
				{:else}
					{#if data.customer?.whatsappPhone}+{data.customer.whatsappPhone} · {/if}{data.conversation.channel.toLowerCase()}
				{/if}
			</p>
		</div>
	</div>
	<div class="flex shrink-0 items-center gap-1.5">
		{#if data.conversation.bookingRequestId}
			<a href="/app/booking-requests/{data.conversation.bookingRequestId}" class="btn-secondary !py-1.5 text-xs">Open enquiry</a>
		{/if}
		{#if moduleRelevant(data.tenant.capabilities, 'orders') && data.permissions?.includes('orders:write')}
			<a href="/app/orders/new?conversation={data.conversation.id}" class="btn-primary !py-1.5 text-xs">Create order</a>
		{/if}
		{#if data.context.length || Number(data.outstanding) > 0}
			<button class="btn-secondary !px-2 !py-1.5 text-xs" onclick={() => (showContext = !showContext)} aria-label="Customer details">
				{showContext ? 'Hide details' : 'Details'}
			</button>
		{/if}
	</div>
</header>

<!-- Assignment + visibility — only rendered for conversations:assign holders (§8) -->
{#if data.teamMembers.length}
	<div class="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-1.5 text-[11px] text-slate-500">
		{#if data.conversation.assignedToUserId !== data.user.id}
			<!-- The most common assignment action, one thumb-tap on mobile -->
			<form method="POST" action="?/access" use:enhance>
				<input type="hidden" name="assignedToUserId" value={data.user.id} />
				<button class="btn-primary !px-3 !py-1 text-[11px]">Take</button>
			</form>
		{/if}
		<form method="POST" action="?/access" use:enhance class="flex items-center gap-1.5">
			<label for="c-assignee">Assigned to</label>
			<select
				id="c-assignee" name="assignedToUserId" class="input w-auto !py-1 text-[11px]"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				<option value="" selected={!data.conversation.assignedToUserId}>— nobody —</option>
				{#each data.teamMembers as m (m.userId)}
					<option value={m.userId} selected={m.userId === data.conversation.assignedToUserId}>{m.fullName || m.email}</option>
				{/each}
			</select>
		</form>
		<form method="POST" action="?/access" use:enhance class="flex items-center gap-1.5">
			<label for="c-visibility">Visible to</label>
			<select
				id="c-visibility" name="visibility" class="input w-auto !py-1 text-[11px]"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				<option value="TEAM" selected={data.conversation.visibility === 'TEAM'}>Whole team</option>
				<option value="ASSIGNED" selected={data.conversation.visibility === 'ASSIGNED'}>Assigned person only</option>
				<option value="PRIVATE" selected={data.conversation.visibility === 'PRIVATE'}>Private</option>
			</select>
		</form>
	</div>
{/if}

<!-- One-tap batch order: the fish-seller move, straight from the chat -->
{#if canOrder && data.openBatch}
	<form
		method="POST"
		action="?/addToBatch"
		class="flex items-center gap-2 border-b border-slate-100 bg-brand-50/40 px-4 py-2"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') batchQty = '';
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="batchId" value={data.openBatch.id} />
		<span class="hidden text-[11px] text-slate-500 sm:block">Add to <b class="text-slate-700">{data.openBatch.name}</b></span>
		<span class="text-[11px] text-slate-500 sm:hidden">Add to batch</span>
		<input
			type="number" min="1" inputmode="numeric" name="quantity" bind:value={batchQty}
			placeholder={data.openBatch.unit ? `Qty (${data.openBatch.unit})` : 'Qty'}
			class="input h-9 w-24 text-center text-sm font-semibold"
		/>
		{#if Number(batchQty) > 0}
			<span class="text-[11px] font-semibold tabular-nums text-slate-600">
				= {data.openBatch.currency} {(Number(batchQty) * Number(data.openBatch.unitPrice)).toLocaleString()}
			</span>
		{/if}
		<button class="btn-primary !py-1.5 text-xs" disabled={!batchQty}>Add order</button>
		{#if form?.added}
			<span class="ml-auto truncate text-[11px] text-success">✓ {form.added.orderNumber} added</span>
		{/if}
	</form>
{/if}

<!-- §9: the customer says they've paid — staff see it right here, with the next step -->
{#if data.paymentRequest}
	<div class="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 {data.paymentRequest.status === 'REPORTED' ? 'bg-orange/10' : 'bg-warning/10'}">
		<span class="text-xs font-semibold text-slate-800">
			{data.paymentRequest.status === 'REPORTED' ? 'Payment reported' : data.paymentRequest.status === 'PARTIALLY_PAID' ? 'Payment partially received' : 'Payment requested'}
		</span>
		<span class="text-xs tabular-nums text-slate-600">{data.paymentRequest.currency} {data.paymentRequest.amountRequested}</span>
		{#if data.paymentRequest.status === 'REPORTED'}
			<span class="badge bg-orange/15 text-orange">Verification needed</span>
			<a href="/app/payments?verify={data.paymentRequest.id}" class="ml-auto text-xs font-semibold text-brand-600 hover:underline">Verify payment</a>
		{:else}
			<span class="ml-auto text-[11px] text-slate-500">waiting for the customer to pay</span>
		{/if}
	</div>
{/if}

<!-- §7: what this customer already has going on, without leaving the chat -->
{#if data.context.length}
	<div class="flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 bg-white px-4 py-2">
		{#each data.context.slice(0, showContext ? 6 : 3) as t (t.kind + t.id)}
			<a
				href="{KIND_HREF[t.kind]}/{t.id}"
				class="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition hover:border-brand-300 {t.this_thread ? 'border-brand-200 bg-brand-50/60' : 'border-slate-200 bg-white'}"
			>
				<span class="font-semibold text-slate-700">{t.reference}</span>
				<StatusBadge value={t.status} size="xs" />
				<span class="tabular-nums text-slate-500"><Money amount={t.total} currency={t.currency} /></span>
			</a>
		{/each}
		{#if Number(data.outstanding) > 0}
			<span class="ml-auto shrink-0 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-[#b58514]">
				Owes <Money amount={data.outstanding} currency={data.context[0]?.currency ?? data.tenant.currency} />
			</span>
		{/if}
	</div>
{/if}

{#if showContext}
	<div class="grid gap-x-6 gap-y-1.5 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-xs sm:grid-cols-3">
		<div><span class="text-slate-400">Customer</span> <span class="ml-1 font-medium text-slate-700">{who}</span></div>
		{#if data.customer?.whatsappPhone}<div><span class="text-slate-400">WhatsApp</span> <span class="ml-1 font-medium text-slate-700">+{data.customer.whatsappPhone}</span></div>{/if}
		{#if data.customer?.email}<div><span class="text-slate-400">Email</span> <span class="ml-1 font-medium text-slate-700">{data.customer.email}</span></div>{/if}
		{#if data.customer?.notes}<div class="sm:col-span-3"><span class="text-slate-400">Notes</span> <span class="ml-1 text-slate-600">{data.customer.notes}</span></div>{/if}
	</div>
{/if}

<div class="flex-1 space-y-2.5 overflow-y-auto bg-canvas/60 p-4">
	{#each data.messages as m (m.id)}
		{@const tick = TICKS[m.status] ?? TICKS.QUEUED}
		<div class="flex {m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}">
			<div class="max-w-[78%] rounded-panel px-3 py-2 text-[13.5px] {m.direction === 'OUTBOUND' ? 'rounded-br-none bg-brand-500 text-white' : 'rounded-bl-none border border-slate-200 bg-white text-slate-700'}">
				<p class="whitespace-pre-wrap">{messagePreview(m.body, m.type)}</p>
				<p class="mt-1 flex items-center justify-end gap-1 text-[10px] {m.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400'}">
					<TimeAgo value={m.createdAt} timezone={data.tenant.timezone} />
					{#if m.direction === 'OUTBOUND'}
						{#if m.status === 'FAILED'}
							<span class="font-semibold {m.direction === 'OUTBOUND' ? 'text-white' : 'text-danger'}">failed</span>
						{:else if tick.marks > 0}
							<svg class="size-3.5 {tick.tinted ? 'text-[#9be7ff]' : ''}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
								<path d="m3 10.5 3.5 3.5L13 7.5" />
								{#if tick.marks === 2}<path d="m9 13.5.5.5L16 7.5" />{/if}
							</svg>
						{/if}
					{/if}
					{#if m.errorMessage}<span>· {m.errorMessage}</span>{/if}
				</p>
			</div>
			{#if primaryAiAction && m.direction === 'INBOUND' && (m.body ?? '').trim().length > 6}
				<form
					method="POST"
					action={primaryAiAction.key === 'enquiry' ? '?/suggestEnquiry' : '?/suggestOrder'}
					use:enhance={() => { suggestingFor = m.id; return async ({ update }) => { await update({ reset: false }); suggestingFor = null; }; }}
				>
					<input type="hidden" name="messageId" value={m.id} />
					<button class="mt-1 text-[11px] font-medium text-brand-600 hover:underline disabled:opacity-50" disabled={suggestingFor === m.id}>
						{suggestingFor === m.id ? 'Reading…' : `✦ ${primaryAiAction.label}`}
					</button>
				</form>
			{/if}
		</div>
	{:else}
		<p class="py-10 text-center text-xs text-slate-400">No messages yet.</p>
	{/each}
</div>

<!-- Enquiry draft (tour/booking businesses). Nothing exists until Create enquiry. -->
{#if enquiry}
	{@const x = enquiry.extraction}
	<div class="border-t border-brand-200 bg-brand-50/50 p-3">
		{#if !enquiry.shouldCreateEnquiry}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<p class="text-[13px] text-slate-600">
					Read as <b>{INTENT_LABEL[x.intent] ?? x.intent.toLowerCase().replace(/_/g, ' ')}</b> — not a new trip enquiry, so nothing was prefilled.
					{#if x.urgent}<span class="badge bg-danger/10 text-danger ml-1">needs attention</span>{/if}
				</p>
				<form method="POST" action="?/discardSuggestion" use:enhance>
					<input type="hidden" name="usageId" value={enquiry.usageId ?? ''} />
					<button class="text-[11px] text-slate-400 hover:underline">Dismiss</button>
				</form>
			</div>
		{:else}
			<form method="POST" action="?/createEnquiry" use:enhance oninput={() => (enquiryEdited = true)} class="space-y-2.5">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-[11px] font-bold tracking-wide text-brand-700 uppercase">✦ Trip enquiry detected</span>
					<span class="badge {x.confidence === 'HIGH' ? 'bg-success/10 text-success' : x.confidence === 'MEDIUM' ? 'bg-warning/10 text-warning' : 'bg-slate-100 text-slate-500'} text-[10px]">{x.confidence.toLowerCase()} confidence</span>
					{#if enquiry.externalTour?.name}<span class="badge bg-purple/10 text-purple text-[10px]">from website: {enquiry.externalTour.name}</span>{/if}
					{#if enquiry.suggestedMatch}<span class="badge bg-slate-100 text-slate-500 text-[10px]">suggested match: {enquiry.suggestedMatch.title}</span>{/if}
				</div>

				<input type="hidden" name="usageId" value={enquiry.usageId ?? ''} />
				<input type="hidden" name="edited" value={enquiryEdited ? '1' : '0'} />
				<input type="hidden" name="externalReference" value={enquiry.externalTour?.reference ?? ''} />
				<input type="hidden" name="externalSource" value={enquiry.externalTour?.name ? 'website' : ''} />
				<input type="hidden" name="whenText" value={x.travel.whenText ?? ''} />
				<input type="hidden" name="budgetAmount" value={x.budget.amount ?? ''} />
				<input type="hidden" name="budgetCurrency" value={x.budget.currency ?? ''} />
				<input type="hidden" name="budgetBasis" value={x.budget.basis ?? ''} />
				<input type="hidden" name="accommodation" value={x.accommodation ?? ''} />
				<input type="hidden" name="destinations" value={x.travel.destinations.join(', ')} />

				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					<label class="block"><span class="text-[10px] text-slate-500">Adults</span><input name="adults" value={x.travellers.adults ?? x.travellers.total ?? ''} inputmode="numeric" class="input py-1.5 text-[13px]" /></label>
					<label class="block"><span class="text-[10px] text-slate-500">Children</span><input name="children" value={x.travellers.children ?? 0} inputmode="numeric" class="input py-1.5 text-[13px]" /></label>
					<label class="block"><span class="text-[10px] text-slate-500">Start date</span><input name="startDate" type="date" value={x.travel.resolvedStartDate ?? ''} class="input py-1.5 text-[13px]" /></label>
					<label class="block"><span class="text-[10px] text-slate-500">Days</span><input value={x.travel.durationDays ?? ''} disabled class="input py-1.5 text-[13px] opacity-70" /></label>
				</div>

				<label class="block"><span class="text-[10px] text-slate-500">Trip notes (goes on the enquiry)</span>
					<textarea name="notes" rows="4" class="input text-[13px]">{enquiryNotesText}</textarea>
				</label>

				<p class="text-[11px] leading-relaxed text-slate-500">
					{#if x.travel.whenText}Customer said <b>"{x.travel.whenText}"</b>{#if !x.travel.resolvedStartDate} — no exact date set, confirm it with them{/if}. {/if}
					{#if x.budget.amount}Budget noted as {x.budget.currency} {x.budget.amount.toLocaleString()}{x.budget.basis === 'PER_PERSON' ? '/person' : ''} — recorded as their budget, not a price. {/if}
				</p>

				{#if x.missing.length}
					<p class="text-[11px] text-slate-500"><b>Useful details to ask next:</b> {x.missing.join(' · ')}</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<button class="btn-primary !py-1.5 text-xs">Create enquiry</button>
					<button formaction="?/discardSuggestion" class="text-[11px] text-slate-400 hover:underline">Discard</button>
					<span class="text-[11px] text-slate-400">{enquiry.customer?.name ?? 'This customer'} · nothing is saved until you press create</span>
				</div>
			</form>
		{/if}
	</div>
{/if}

<!-- Reply draft: text in a box. Sending still goes through the normal composer. -->
{#if replyDraft}
	<div class="border-t border-slate-200 bg-slate-50 p-3">
		<div class="mb-1.5 flex flex-wrap items-center gap-2">
			<span class="text-[11px] font-bold tracking-wide text-slate-600 uppercase">✦ Suggested reply</span>
			<span class="text-[11px] text-slate-400">Edit it, then send — or discard.</span>
		</div>
		<textarea bind:value={replyText} oninput={() => (replyEdited = true)} rows="3" class="input text-[13px]"></textarea>
		{#if replyDraft.caveats.length}
			<p class="mt-1 text-[11px] text-warning">Check before sending: {replyDraft.caveats.join(' · ')}</p>
		{/if}
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<form method="POST" action="?/send" use:enhance={() => async ({ update }) => { await update({ reset: true }); }}>
				<input type="hidden" name="body" value={replyText} />
				<input type="hidden" name="aiUsageId" value={replyDraft.usageId ?? ''} />
				<input type="hidden" name="aiEdited" value={replyEdited ? '1' : '0'} />
				<button class="btn-primary !py-1.5 text-xs">Send reply</button>
			</form>
			<form method="POST" action="?/discardSuggestion" use:enhance>
				<input type="hidden" name="usageId" value={replyDraft.usageId ?? ''} />
				<button class="text-[11px] text-slate-400 hover:underline">Discard</button>
			</form>
		</div>
	</div>
{/if}

<!-- Catch-up summary, with Connect's verified records shown separately. -->
{#if summary}
	<div class="border-t border-slate-200 bg-white p-3">
		<div class="mb-1 flex items-center justify-between gap-2">
			<span class="text-[13px] font-semibold text-slate-800">{summary.headline}</span>
			<form method="POST" action="?/discardSuggestion" use:enhance>
				<input type="hidden" name="usageId" value={summary.usageId ?? ''} />
				<button class="text-[11px] text-slate-400 hover:underline">Close</button>
			</form>
		</div>
		<ul class="space-y-0.5 text-[12.5px] text-slate-600">
			{#each summary.points as point (point)}<li>• {point}</li>{/each}
		</ul>
		{#if summary.nextStep}<p class="mt-1.5 text-[12px] text-slate-500"><b>Waiting on:</b> {summary.nextStep}</p>{/if}
		{#if summary.state.length}
			<p class="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">From your records: {summary.state.join(' ')}</p>
		{/if}
	</div>
{/if}

<!-- AI suggestion: a draft the seller edits and commits. Nothing is saved until
     they press Create order — the assistant never writes to the ledger itself. -->
{#if suggestion}
	<div class="border-t border-brand-200 bg-brand-50/50 p-3">
		{#if !suggestion.draft.isOrder}
			<div class="flex items-center justify-between gap-2">
				<p class="text-[13px] text-slate-600">This message doesn't look like an order — nothing to prefill.</p>
				<a href="/app/orders/new" class="text-[12px] font-medium text-brand-600 hover:underline">Create manually →</a>
			</div>
		{:else}
			<form method="POST" action="?/createSuggested" use:enhance class="space-y-2.5">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-[11px] font-bold tracking-wide text-brand-700 uppercase">Suggested order</span>
					<span class="badge {suggestion.draft.confidence === 'high' ? 'bg-success/10 text-success' : suggestion.draft.confidence === 'medium' ? 'bg-warning/10 text-warning' : 'bg-slate-100 text-slate-500'} text-[10px]">
						{suggestion.draft.confidence} confidence
					</span>
					<span class="text-[11px] text-slate-500">Check it before creating — you can edit every field.</span>
				</div>

				<input type="hidden" name="currency" value={suggestion.currency} />
				{#if suggestion.batch}<input type="hidden" name="batchId" value={suggestion.batch.id} />{/if}

				{#each draftLines as line, i (i)}
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1.2fr]">
						<input name="itemTitle" bind:value={line.title} placeholder="Item" class="input py-1.5 text-[13px]" />
						<input name="itemQuantity" bind:value={line.quantity} inputmode="numeric" placeholder="Qty" class="input py-1.5 text-[13px]" />
						<input name="itemUnit" value={line.unit ?? ''} placeholder="Unit" class="input py-1.5 text-[13px]" />
						<input
							name="itemPrice"
							value={line.unitPrice ?? ''}
							inputmode="decimal"
							placeholder="Price / unit"
							class="input py-1.5 text-[13px] {line.unitPrice ? '' : 'border-warning'}"
						/>
					</div>
				{/each}

				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
					<select name="deliveryMethod" bind:value={draftMethod} class="input py-1.5 text-[13px]">
						<option value="">Method —</option>
						<option value="PICKUP">Pickup</option>
						<option value="DELIVERY">Delivery</option>
					</select>
					<input name="deliveryLocation" bind:value={draftLocation} placeholder="Delivery location" class="input py-1.5 text-[13px]" />
					<input name="notes" value={suggestion.draft.notes ?? ''} placeholder="Notes" class="input py-1.5 text-[13px]" />
				</div>

				{#if suggestion.draft.whenText || suggestion.draft.missing.length || draftLines.some((l) => !l.unitPrice)}
					<p class="text-[11px] text-slate-500">
						{#if suggestion.draft.whenText}Customer said <b>"{suggestion.draft.whenText}"</b> — set the date on the order after creating. {/if}
						{#if draftLines.some((l) => !l.unitPrice)}<span class="text-warning">Add a price for the highlighted line.</span> {/if}
						{#if suggestion.draft.missing.length}Unclear: {suggestion.draft.missing.join(', ')}.{/if}
					</p>
				{/if}

				<div class="flex items-center gap-2">
					<button class="btn-primary !py-1.5 text-xs">Create order</button>
					<span class="text-[11px] text-slate-400">Awaiting confirmation · {suggestion.customer?.name ?? 'this customer'}</span>
				</div>
			</form>
		{/if}
	</div>
{/if}

{#if data.aiReady}
	<div class="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 pt-2">
		{#each (data.aiActions ?? []).filter((a) => a.key === 'reply' || a.key === 'summary') as action (action.key)}
			<form
				method="POST"
				action={action.key === 'reply' ? '?/suggestReply' : '?/summarize'}
				use:enhance={() => { busyAction = action.key; return async ({ update }) => { await update({ reset: false }); busyAction = null; }; }}
			>
				<button class="rounded-panel border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50" disabled={busyAction === action.key} title={action.hint}>
					{busyAction === action.key ? 'Thinking…' : `✦ ${action.label}`}
				</button>
			</form>
		{/each}
		{#if primaryAiAction?.key === 'enquiry'}
			<form method="POST" action="?/suggestEnquiry" use:enhance={() => { busyAction = 'conv'; return async ({ update }) => { await update({ reset: false }); busyAction = null; }; }}>
				<input type="hidden" name="scope" value="conversation" />
				<button class="rounded-panel border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50" disabled={busyAction === 'conv'} title="Read the whole recent thread, not just one message">
					{busyAction === 'conv' ? 'Reading…' : '✦ Create enquiry from conversation'}
				</button>
			</form>
		{/if}
	</div>
{/if}

{#if canSend}
	<form method="POST" action="?/send" use:enhance class="flex items-center gap-2 border-t border-slate-200 p-3">
		<input
			name="text"
			placeholder="Enter your message…"
			autocomplete="off"
			class="input bg-slate-50 focus:bg-white"
			bind:value={composerText}
			oninput={() => {
				const wasTyping = Date.now() < typingUntil;
				typingUntil = Date.now() + 6000;
				if (!wasTyping) void beat();
			}}
		/>
		<button class="btn-primary shrink-0 !px-3" aria-label="Send">
			<svg class="size-4.5" viewBox="0 0 20 20" fill="currentColor"><path d="M2.5 3.4c-.3-.9.6-1.7 1.4-1.3l13.6 6.6c.8.4.8 1.5 0 1.9L3.9 17.2c-.8.4-1.7-.4-1.4-1.3l1.9-5.4c.1-.2.1-.5 0-.7L2.5 3.4Zm2.1 6.1h5.9a.5.5 0 0 1 0 1H4.6l-1.5 4.4 12.4-6-12.4-6 1.5 4.4Z" /></svg>
		</button>
	</form>
{/if}
