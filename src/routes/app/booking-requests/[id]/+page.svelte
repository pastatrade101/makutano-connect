<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$app/forms';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const STATUSES = ['NEW', 'UNDER_REVIEW', 'CONTACTED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CANCELLED'];
	const tz = $derived(data.tenant.timezone);
	const canWrite = $derived(data.permissions?.includes('booking_requests:write'));
	const canSend = $derived(data.permissions?.includes('whatsapp:send'));
	const traveller = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || 'Unknown traveller');
</script>

<svelte:head><title>{data.request.reference} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Saved" />

<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/booking-requests" class="text-xs text-slate-500 hover:underline">← Booking requests</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">
				{data.request.reference}
				<StatusBadge value={data.request.status} />
			</h1>
		</div>
		{#if canWrite}
			<form method="POST" action="?/status" use:enhance class="flex items-center gap-2">
				<select name="status" class="input w-auto">
					{#each STATUSES as s (s)}
						<option value={s} selected={data.request.status === s}>{s.replace(/_/g, ' ')}</option>
					{/each}
				</select>
				<button class="btn-primary">Update</button>
			</form>
		{/if}
	</div>

	{#if form?.message}
		<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
	{/if}

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Trip</header>
				<dl class="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-4">
					<div><dt class="text-[11px] uppercase text-slate-500">Start</dt><dd>{data.request.startDate ? new Date(data.request.startDate).toLocaleDateString('en-GB', { timeZone: tz }) : '—'}</dd></div>
					<div><dt class="text-[11px] uppercase text-slate-500">End</dt><dd>{data.request.endDate ? new Date(data.request.endDate).toLocaleDateString('en-GB', { timeZone: tz }) : '—'}</dd></div>
					<div><dt class="text-[11px] uppercase text-slate-500">Travellers</dt><dd class="tabular-nums">{data.request.adults} adults · {data.request.children} children</dd></div>
					<div><dt class="text-[11px] uppercase text-slate-500">Estimated</dt><dd><Money amount={data.request.estimatedTotal} currency={data.request.currency} /></dd></div>
					{#if data.request.externalReference}
						<div class="col-span-2">
							<dt class="text-[11px] uppercase text-slate-500">Client catalog reference</dt>
							<dd class="font-mono text-xs">{data.request.externalSource ?? 'external'}:{data.request.externalReference}</dd>
						</div>
					{/if}
					{#if data.request.notes}
						<div class="col-span-full"><dt class="text-[11px] uppercase text-slate-500">Notes</dt><dd class="whitespace-pre-wrap text-slate-700">{data.request.notes}</dd></div>
					{/if}
				</dl>
			</section>

			{#if data.items.length}
				<section class="card">
					<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Requested items</header>
					<table class="min-w-full divide-y divide-slate-100">
						<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Qty</th><th class="table-head">Total</th></tr></thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.items as item (item.id)}
								<tr>
									<td class="table-cell">
										<div class="font-medium text-slate-800">{item.title}</div>
										{#if item.description}<div class="text-[11px] text-slate-500">{item.description}</div>{/if}
									</td>
									<td class="table-cell text-[11px] uppercase text-slate-500">{item.type}</td>
									<td class="table-cell tabular-nums">{item.quantity}</td>
									<td class="table-cell"><Money amount={item.total ?? item.unitPrice} currency={data.request.currency} /></td>
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
						{#if !data.canSeeSensitive}<span class="text-[11px] text-slate-400">Passport details hidden for your role</span>{/if}
					</header>
					<table class="min-w-full divide-y divide-slate-100">
						<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Nationality</th><th class="table-head">Passport</th><th class="table-head">Requests</th></tr></thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.travelers as t (t.id)}
								<tr>
									<td class="table-cell">{[t.firstName, t.lastName].filter(Boolean).join(' ') || '—'}</td>
									<td class="table-cell">{t.nationality ?? '—'}</td>
									<td class="table-cell font-mono text-xs">{t.passportNumber ?? '••••••'}</td>
									<td class="table-cell text-[11px] text-slate-500">{t.specialRequests ?? t.dietaryRequirements ?? '—'}</td>
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
									<p class="mt-0.5 text-[10px] {m.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400'}">
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
					{#if data.customer?.country}<div class="text-[11px] uppercase text-slate-500">{data.customer.country}</div>{/if}
					{#if data.customer}
						<a href="/app/customers?q={data.customer.email ?? data.customer.whatsappPhone ?? ''}" class="mt-2 inline-block text-xs text-brand-600 hover:underline">Customer record →</a>
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
							<p class="mt-0.5 text-[11px] text-slate-400"><TimeAgo value={note.createdAt} timezone={tz} /></p>
						</li>
					{:else}
						<li class="px-3 py-6 text-center text-xs text-slate-500">No notes yet.</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>
