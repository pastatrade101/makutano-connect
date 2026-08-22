<script lang="ts">
	import StatusBadge from '$components/StatusBadge.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Usage · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-base font-semibold text-slate-900">Usage &amp; subscriptions <span class="text-xs font-normal text-slate-500">· {data.period}</span></h1>

	<section class="card overflow-x-auto">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">API usage this period</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">API</th><th class="table-head">WA out</th><th class="table-head">WA in</th><th class="table-head">Requests</th><th class="table-head">Webhooks</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.usage as row, i (i)}
					<tr>
						<td class="table-cell font-medium text-slate-800">{row.tenant_name}</td>
						<td class="table-cell tabular-nums">{row.api_requests}</td>
						<td class="table-cell tabular-nums">{row.whatsapp_outbound}</td>
						<td class="table-cell tabular-nums">{row.whatsapp_inbound}</td>
						<td class="table-cell tabular-nums">{row.booking_requests}</td>
						<td class="table-cell tabular-nums">{row.webhook_deliveries}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="card overflow-x-auto">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Subscriptions</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Plan</th><th class="table-head">Status</th><th class="table-head">Period ends</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.subscriptions as row (row.subscription.id)}
					<tr>
						<td class="table-cell">{row.tenant.name}</td>
						<td class="table-cell">{row.plan.name}</td>
						<td class="table-cell"><StatusBadge value={row.subscription.status} /></td>
						<td class="table-cell text-slate-500">{new Date(row.subscription.currentPeriodEnd).toLocaleDateString('en-GB')}</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-3 py-6 text-center text-xs text-slate-500">No subscriptions yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
