<script lang="ts">
	import { nextForQuotation } from '$lib/next-action';
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	// Same precedence as the order screen and the thread: a draft wants sending, a sent
	// quote wants a decision. Whichever it is, it is the only primary on the page.
	const next = $derived(
		nextForQuotation(
			{
				id: data.quotation.id,
				status: data.quotation.status,
				convertedBookingId: data.quotation.convertedBookingId
			},
			{
				quotations:
					(data.permissions?.includes('quotations:write') ?? false) &&
					data.entitlements?.['quotations.enabled'] === true,
				bookings: data.permissions?.includes('bookings:read') ?? false
			}
		)
	);

	const canWrite = $derived(data.permissions?.includes('quotations:write'));
	const canBook = $derived(data.permissions?.includes('bookings:write'));
	const isOpen = $derived(!['CONVERTED', 'DECLINED', 'EXPIRED'].includes(data.quotation.status));
</script>

<svelte:head><title>{data.quotation.reference} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Quotation updated" />

<div class="mx-auto max-w-4xl space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/quotations" class="text-xs text-slate-500 hover:underline">← Quotations</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">{data.quotation.reference} <StatusBadge value={data.quotation.status} /></h1>
		</div>
		<div class="flex gap-2">
			{#if canWrite && isOpen}
				<form method="POST" action="?/send" use:enhance><button class={next?.key === 'send_quotation' ? 'btn-primary' : 'btn-secondary'}>{data.quotation.status === 'DRAFT' ? 'Send' : 'Resend'}</button></form>
			{/if}
			{#if canBook && isOpen}
				<form method="POST" action="?/accept" use:enhance><button class={next?.key === 'accept_quotation' ? 'btn-primary' : 'btn-secondary'}>Accept &amp; convert</button></form>
			{/if}
		</div>
	</div>


	{#if data.quotation.convertedBookingId}
		<p class="rounded-panel bg-success/10 px-3 py-2 text-xs text-success">
			Converted to a booking. <a href="/app/bookings/{data.quotation.convertedBookingId}" class="font-semibold underline">Open booking →</a>
		</p>
	{/if}

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">
				{[data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || 'No customer attached'}
			</h2>
			<span class="text-[12.5px] text-slate-500">v{data.quotation.version} · <TimeAgo value={data.quotation.createdAt} timezone={data.tenant.timezone} /></span>
		</header>
		<ul class="divide-y divide-slate-100 sm:hidden">
			{#each data.items as item (item.id)}
				<li class="p-3">
					<div class="flex items-start justify-between gap-4"><div class="min-w-0"><p class="font-medium text-slate-800">{item.title}</p>{#if item.description}<p class="text-xs text-slate-500">{item.description}</p>{/if}</div><p class="shrink-0 font-semibold"><Money amount={item.total} currency={data.quotation.currency} /></p></div>
					<p class="mt-2 text-xs text-slate-500">{item.quantity} × <Money amount={item.unitPrice} currency={data.quotation.currency} /></p>
				</li>
			{/each}
		</ul>
		<table class="hidden min-w-full divide-y divide-slate-100 sm:table">
			<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Qty</th><th class="table-head">Unit</th><th class="table-head">Total</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.items as item (item.id)}
					<tr>
						<td class="table-cell">
							<div class="font-medium text-slate-800">{item.title}</div>
							{#if item.description}<div class="text-[12.5px] text-slate-500">{item.description}</div>{/if}
						</td>
						<td class="table-cell tabular-nums">{item.quantity}</td>
						<td class="table-cell"><Money amount={item.unitPrice} currency={data.quotation.currency} /></td>
						<td class="table-cell"><Money amount={item.total} currency={data.quotation.currency} /></td>
					</tr>
				{/each}
			</tbody>
			<tfoot class="bg-slate-50 text-sm">
				<tr><td colspan="3" class="table-cell text-right text-slate-500">Subtotal</td><td class="table-cell"><Money amount={data.quotation.subtotal} currency={data.quotation.currency} /></td></tr>
				{#if Number(data.quotation.discount) > 0}
					<tr><td colspan="3" class="table-cell text-right text-slate-500">Discount</td><td class="table-cell text-success">−<Money amount={data.quotation.discount} currency={data.quotation.currency} /></td></tr>
				{/if}
				{#if Number(data.quotation.tax) > 0}
					<tr><td colspan="3" class="table-cell text-right text-slate-500">Tax</td><td class="table-cell"><Money amount={data.quotation.tax} currency={data.quotation.currency} /></td></tr>
				{/if}
				<tr class="font-semibold"><td colspan="3" class="table-cell text-right">Total</td><td class="table-cell"><Money amount={data.quotation.total} currency={data.quotation.currency} /></td></tr>
			</tfoot>
		</table>
		<div class="space-y-1 border-t border-slate-100 bg-slate-50 px-3 py-2.5 text-sm sm:hidden">
			<div class="flex justify-between text-slate-500"><span>Subtotal</span><Money amount={data.quotation.subtotal} currency={data.quotation.currency} /></div>
			{#if Number(data.quotation.discount) > 0}<div class="flex justify-between text-success"><span>Discount</span><span>−<Money amount={data.quotation.discount} currency={data.quotation.currency} /></span></div>{/if}
			{#if Number(data.quotation.tax) > 0}<div class="flex justify-between text-slate-500"><span>Tax</span><Money amount={data.quotation.tax} currency={data.quotation.currency} /></div>{/if}
			<div class="flex justify-between border-t border-slate-200 pt-1.5 font-bold text-slate-800"><span>Total</span><Money amount={data.quotation.total} currency={data.quotation.currency} /></div>
		</div>
		{#if data.quotation.terms}
			<div class="border-t border-slate-200 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-slate-500">{data.quotation.terms}</div>
		{/if}
	</section>
</div>
