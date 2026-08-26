<script lang="ts">
	import StatusBadge from '$components/StatusBadge.svelte';
	let { data } = $props();

	const KIND_LABEL: Record<string, string> = {
		customer: 'Customer',
		order: 'Order',
		booking: 'Booking',
		request: 'Enquiry',
		quotation: 'Quotation'
	};
</script>

<svelte:head><title>Search · {data.tenant.name}</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-3">
	<form method="GET" class="flex gap-2">
		<input
			name="q"
			value={data.q}
			placeholder="Name, phone number, or a reference like ORD-…"
			class="input h-11 flex-1"
		/>
		<button class="btn-primary h-11">Search</button>
	</form>

	{#if data.q.length >= 2}
		{#if data.hits.length === 0}
			<div class="card p-8 text-center">
				<p class="text-sm font-medium text-slate-700">Nothing found for “{data.q}”</p>
				<p class="mt-1 text-xs text-slate-500">Try part of the name, the phone number, or the reference from a WhatsApp message.</p>
			</div>
		{:else}
			<div class="card divide-y divide-slate-100">
				{#each data.hits as hit (hit.kind + hit.id)}
					<a href={hit.href} class="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
						<span class="w-20 shrink-0 text-[11.5px] font-semibold tracking-wide text-slate-400 uppercase">{KIND_LABEL[hit.kind]}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-medium text-slate-700">{hit.title}</span>
							{#if hit.subtitle}<span class="block truncate text-[12.5px] text-slate-400">{hit.subtitle}</span>{/if}
						</span>
						{#if hit.status}<StatusBadge value={hit.status} size="xs" />{/if}
					</a>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="text-center text-xs text-slate-400">Type at least two characters — customers, orders, bookings, enquiries and quotations are all searched.</p>
	{/if}
</div>
