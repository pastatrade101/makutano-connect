<script lang="ts">
	import Money from '$components/Money.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Errors · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-base font-semibold text-slate-900">Delivery &amp; payment errors</h1>

	<section class="card overflow-x-auto">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Client webhook failures</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Event</th><th class="table-head">Endpoint</th><th class="table-head">Attempts</th><th class="table-head">Response</th><th class="table-head">Error</th><th class="table-head">When</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.webhooks as row (row.delivery.id)}
					<tr>
						<td class="table-cell">{row.tenant.name}</td>
						<td class="table-cell font-mono text-xs">{row.delivery.event}</td>
						<td class="table-cell max-w-[16rem] truncate font-mono text-[11px] text-slate-500">{row.endpoint.url}</td>
						<td class="table-cell tabular-nums">{row.delivery.attempts}</td>
						<td class="table-cell tabular-nums">{row.delivery.responseStatus ?? '—'}</td>
						<td class="table-cell max-w-[16rem] truncate text-xs text-danger">{row.delivery.errorMessage ?? '—'}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={row.delivery.createdAt} /></td>
					</tr>
				{:else}
					<tr><td colspan="7" class="px-3 py-6 text-center text-xs text-slate-500">No webhook failures.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="card overflow-x-auto">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Payment failures</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Reference</th><th class="table-head">Provider</th><th class="table-head">Amount</th><th class="table-head">Reason</th><th class="table-head">When</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.payments as row (row.payment.id)}
					<tr>
						<td class="table-cell">{row.tenant.name}</td>
						<td class="table-cell font-mono text-xs">{row.payment.reference}</td>
						<td class="table-cell text-[11px] uppercase text-slate-500">{row.payment.provider}</td>
						<td class="table-cell"><Money amount={row.payment.amount} currency={row.payment.currency} /></td>
						<td class="table-cell text-xs text-danger">{row.payment.failureMessage ?? row.payment.failureCode ?? '—'}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={row.payment.createdAt} /></td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-3 py-6 text-center text-xs text-slate-500">No payment failures.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="card overflow-x-auto">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Failed WhatsApp sends</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">To</th><th class="table-head">Type</th><th class="table-head">Error</th><th class="table-head">When</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.messages as row (row.message.id)}
					<tr>
						<td class="table-cell">{row.tenant.name}</td>
						<td class="table-cell font-mono text-xs">{row.message.toAddress ?? '—'}</td>
						<td class="table-cell text-[11px] uppercase text-slate-500">{row.message.type}</td>
						<td class="table-cell max-w-[20rem] truncate text-xs text-danger">{row.message.errorMessage ?? row.message.errorCode ?? '—'}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={row.message.createdAt} /></td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-3 py-6 text-center text-xs text-slate-500">No failed sends.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
