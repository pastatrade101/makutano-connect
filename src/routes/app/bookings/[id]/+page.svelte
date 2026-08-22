<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$app/forms';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const tz = $derived(data.tenant.timezone);
	const canWrite = $derived(data.permissions?.includes('bookings:write'));
	const canPay = $derived(data.permissions?.includes('payments:write'));
	const NEXT = ['PENDING', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
</script>

<svelte:head><title>{data.booking.bookingReference} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Booking updated" />

<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/bookings" class="text-xs text-slate-500 hover:underline">← Bookings</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">{data.booking.bookingReference} <StatusBadge value={data.booking.status} /></h1>
		</div>
		{#if canWrite}
			<form method="POST" action="?/status" use:enhance class="flex items-center gap-2">
				<select name="status" class="input w-auto">
					{#each NEXT as s (s)}<option value={s} selected={data.booking.status === s}>{s.replace(/_/g, ' ')}</option>{/each}
				</select>
				<input name="reason" placeholder="Reason (optional)" class="input w-auto" />
				<button class="btn-primary">Update</button>
			</form>
		{/if}
	</div>


	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Total</div><div class="text-lg font-semibold"><Money amount={data.booking.total} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Paid</div><div class="text-lg font-semibold text-success"><Money amount={data.booking.amountPaid} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Balance</div><div class="text-lg font-semibold {Number(data.booking.balanceDue) > 0 ? 'text-danger' : 'text-slate-900'}"><Money amount={data.booking.balanceDue} currency={data.booking.currency} /></div></div>
		<div class="card px-3 py-2"><div class="text-[11px] uppercase text-slate-500">Travellers</div><div class="text-lg font-semibold tabular-nums">{data.booking.adults + data.booking.children}</div></div>
	</div>

	<div class="grid gap-3 lg:grid-cols-3">
		<div class="space-y-3 lg:col-span-2">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Items</header>
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Qty</th><th class="table-head">Unit</th><th class="table-head">Total</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as item (item.id)}
							<tr>
								<td class="table-cell font-medium text-slate-800">{item.title}</td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{item.type}</td>
								<td class="table-cell tabular-nums">{item.quantity}</td>
								<td class="table-cell"><Money amount={item.unitPrice} currency={data.booking.currency} /></td>
								<td class="table-cell"><Money amount={item.total} currency={data.booking.currency} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Payments</header>
				{#if canPay}
					<form method="POST" action="?/payment" use:enhance class="flex flex-wrap items-end gap-2 border-b border-slate-100 p-3">
						<div><label class="label" for="amount">Amount</label><input id="amount" name="amount" placeholder="0.00" class="input w-32" /></div>
						<div>
							<label class="label" for="provider">Method</label>
							<select id="provider" name="provider" class="input w-auto"><option value="MANUAL">Manual / cash</option><option value="BANK_TRANSFER">Bank transfer</option></select>
						</div>
						<div class="flex-1"><label class="label" for="description">Note</label><input id="description" name="description" class="input" /></div>
						<button class="btn-primary">Record</button>
					</form>
				{/if}
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Reference</th><th class="table-head">Method</th><th class="table-head">Status</th><th class="table-head">Amount</th><th class="table-head">When</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.payments as p (p.id)}
							<tr>
								<td class="table-cell font-mono text-xs">{p.reference}</td>
								<td class="table-cell text-[11px] uppercase text-slate-500">{p.provider}</td>
								<td class="table-cell"><StatusBadge value={p.status} /></td>
								<td class="table-cell"><Money amount={p.amount} currency={p.currency} /></td>
								<td class="table-cell text-slate-500"><TimeAgo value={p.createdAt} timezone={tz} /></td>
							</tr>
						{:else}
							<tr><td colspan="5" class="px-3 py-6 text-center text-xs text-slate-500">No payments recorded.</td></tr>
						{/each}
					</tbody>
				</table>
			</section>
		</div>

		<div class="space-y-3">
			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Traveller</header>
				<div class="space-y-1 p-3 text-sm">
					<div class="font-medium">{[data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || '—'}</div>
					{#if data.customer?.email}<div class="text-slate-600">{data.customer.email}</div>{/if}
					{#if data.customer?.whatsappPhone}<div class="text-slate-600">+{data.customer.whatsappPhone}</div>{/if}
					{#if data.booking.bookingRequestId}<a href="/app/booking-requests/{data.booking.bookingRequestId}" class="mt-2 inline-block text-xs text-brand-600 hover:underline">Originating request →</a>{/if}
				</div>
			</section>

			<section class="card">
				<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Status history</header>
				<ul class="divide-y divide-slate-100">
					{#each data.history as h (h.id)}
						<li class="px-3 py-2 text-xs">
							<div class="flex items-center gap-1">
								{#if h.fromStatus}<StatusBadge value={h.fromStatus} size="xs" /><span class="text-slate-400">→</span>{/if}
								<StatusBadge value={h.toStatus} size="xs" />
							</div>
							{#if h.reason}<p class="mt-1 text-slate-600">{h.reason}</p>{/if}
							<p class="mt-0.5 text-slate-400"><TimeAgo value={h.createdAt} timezone={tz} /></p>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>
