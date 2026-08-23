<script lang="ts">
	import { moduleRelevant } from '$lib/workspace';
	// Reback chat thread: header with avatar + context, bubbles with delivery ticks
	// (✓ sent, ✓✓ delivered, ✓✓ tinted read), composer pinned at the bottom.
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const canSend = $derived(data.permissions?.includes('whatsapp:send'));
	const who = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || `+${data.conversation.externalId ?? ''}`);
	const initials = $derived(who.replace(/^\+/, '').split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase() || '#');

	const KIND_HREF: Record<string, string> = { order: '/app/orders', booking: '/app/bookings', quotation: '/app/quotations' };
	let showContext = $state(false);
	let batchQty = $state('');
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
				{#if data.customer?.whatsappPhone}+{data.customer.whatsappPhone} · {/if}{data.conversation.channel.toLowerCase()}
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
				<p class="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</p>
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
		</div>
	{:else}
		<p class="py-10 text-center text-xs text-slate-400">No messages yet.</p>
	{/each}
</div>

{#if canSend}
	<form method="POST" action="?/send" use:enhance class="flex items-center gap-2 border-t border-slate-200 p-3">
		<input name="text" placeholder="Enter your message…" autocomplete="off" class="input bg-slate-50 focus:bg-white" />
		<button class="btn-primary shrink-0 !px-3" aria-label="Send">
			<svg class="size-4.5" viewBox="0 0 20 20" fill="currentColor"><path d="M2.5 3.4c-.3-.9.6-1.7 1.4-1.3l13.6 6.6c.8.4.8 1.5 0 1.9L3.9 17.2c-.8.4-1.7-.4-1.4-1.3l1.9-5.4c.1-.2.1-.5 0-.7L2.5 3.4Zm2.1 6.1h5.9a.5.5 0 0 1 0 1H4.6l-1.5 4.4 12.4-6-12.4-6 1.5 4.4Z" /></svg>
		</button>
	</form>
{/if}
