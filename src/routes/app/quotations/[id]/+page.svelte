<script lang="ts">
	import { page } from '$app/state';
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
	<!--
		Arrived straight from an enquiry. Three outcomes, said plainly: saved,
		sent, or saved-but-not-delivered — because "created" over a failed send
		would leave an operator believing a customer holds a price they never
		received.
	-->
	{#if page.url.searchParams.get('sent') === '1'}
		<div class="flex flex-wrap items-center gap-2 rounded-panel border border-success/25 bg-success/5 px-4 py-3">
			<span class="text-sm font-semibold text-slate-900">Quotation sent</span>
			<span class="text-[13px] text-slate-600">It has gone to the traveller by email, and on WhatsApp where that is connected.</span>
		</div>
	{:else if page.url.searchParams.get('sendfailed') === '1'}
		<div class="flex flex-wrap items-center gap-2 rounded-panel border border-warning/30 bg-warning/5 px-4 py-3">
			<span class="text-sm font-semibold text-slate-900">Saved, but not delivered</span>
			<span class="text-[13px] text-slate-600">The quotation exists. Sending it failed — try Send again.</span>
		</div>
	{:else if page.url.searchParams.get('created') === '1'}
		<div class="flex flex-wrap items-center gap-2 rounded-panel border border-success/25 bg-success/5 px-4 py-3">
			<span class="text-sm font-semibold text-slate-900">Quotation saved</span>
			<span class="text-[13px] text-slate-600">Priced from the enquiry — check the lines, then send it.</span>
			<div class="ml-auto flex flex-wrap gap-1.5">
				{#if next?.key === 'send_quotation'}
					<form method="POST" action="?/send" use:enhance><button class="btn-primary !py-1.5 text-xs">Send to the traveller</button></form>
				{/if}
				{#if data.quotation.bookingRequestId}
					<a href="/app/booking-requests/{data.quotation.bookingRequestId}" class="btn-secondary !py-1.5 text-xs">Back to enquiry</a>
				{/if}
			</div>
		</div>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/quotations" class="text-xs text-slate-500 hover:underline">← Quotations</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-900">{data.quotation.reference} <StatusBadge value={data.quotation.status} /></h1>
		</div>
		<div class="flex gap-2">
			{#if canWrite && isOpen}
				<form method="POST" action="?/send" use:enhance>
					<button
						class={next?.key === 'send_quotation' ? 'btn-primary' : 'btn-secondary'}
						title="Emails the traveller their quote, and sends it on WhatsApp too where that is connected."
					>{data.quotation.status === 'DRAFT' ? 'Send' : 'Resend'}</button>
				</form>
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
					<p class="mt-2 text-xs text-slate-500">{item.quantity} × <Money amount={item.unitPrice} currency={data.quotation.currency} /> per person</p>
				</li>
			{/each}
		</ul>
		<table class="hidden min-w-full divide-y divide-slate-100 sm:table">
			<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Travellers</th><th class="table-head">Per person</th><th class="table-head">Total</th></tr></thead>
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
		<!-- notes ARE the message the traveller reads, on their quote page and in
		     their email. Showing terms but not this meant the operator could not
		     see what they had actually said. -->
		{#if data.quotation.notes}
			<div class="border-t border-slate-200 px-3 py-2.5">
				<p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Message to traveller</p>
				<p class="mt-1 text-[13px] whitespace-pre-wrap text-slate-600">{data.quotation.notes}</p>
			</div>
		{/if}
		{#if data.quotation.terms}
			<div class="border-t border-slate-200 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-slate-500">{data.quotation.terms}</div>
		{/if}
	</section>
</div>
