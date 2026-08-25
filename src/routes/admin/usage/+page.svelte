<script lang="ts">
	import StatusBadge from '$components/StatusBadge.svelte';
	let { data } = $props();

	// Only the metrics operators watch daily — the Control Center has the full set.
	const HEADLINE = ['api.maxRequestsPerMonth', 'whatsapp.maxOutboundPerMonth', 'bookings.maxRequestsPerMonth', 'orders.maxPerMonth'];
	const pick = (usage: (typeof data.rows)[number]['usage'], key: string) => usage.find((u) => u.key === key);
	const tone = (p: number) => (p >= 100 ? 'text-danger' : p >= 80 ? 'text-warning' : 'text-slate-700');
</script>

<svelte:head><title>Usage · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-base font-semibold text-slate-800">Usage &amp; subscriptions <span class="text-xs font-normal text-slate-400">· {data.period}</span></h1>

	<section class="card overflow-x-auto">
		<header class="card-header"><h2 class="card-title">Usage against plan limits</h2></header>
		<table class="min-w-[720px] divide-y divide-slate-100 sm:min-w-full">
			<thead class="bg-slate-50">
				<tr>
					<th class="table-head">Tenant</th><th class="table-head">Plan</th>
					<th class="table-head">API</th><th class="table-head">WhatsApp out</th>
					<th class="table-head">Booking requests</th><th class="table-head">Orders</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.rows as row (row.tenantId)}
					<tr class="hover:bg-slate-50">
						<td class="table-cell">
							<a href="/admin/tenants/{row.tenantId}" class="font-medium text-brand-600 hover:underline">{row.name}</a>
							{#if row.status !== 'ACTIVE'}<StatusBadge value={row.status} size="xs" />{/if}
						</td>
						<td class="table-cell text-[12.5px] uppercase text-slate-500">{row.plan}</td>
						{#each HEADLINE as key (key)}
							{@const u = pick(row.usage, key)}
							<td class="table-cell">
								{#if u}
									<div class="tabular-nums {u.unlimited ? 'text-slate-700' : tone(u.percent)}">
										{u.used}{u.unlimited ? '' : ` / ${u.limit}`}
									</div>
									{#if !u.unlimited}
										<div class="mt-1 h-1 w-24 overflow-hidden rounded-full bg-slate-100">
											<div class="h-full rounded-full {u.percent >= 100 ? 'bg-danger' : u.percent >= 80 ? 'bg-warning' : 'bg-brand-500'}" style="width: {u.percent}%"></div>
										</div>
									{/if}
								{:else}—{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="card overflow-x-auto">
		<header class="card-header"><h2 class="card-title">Subscriptions</h2></header>
		<table class="min-w-[720px] divide-y divide-slate-100 sm:min-w-full">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Plan</th><th class="table-head">Status</th><th class="table-head">Period ends</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.subscriptions as row (row.subscription.id)}
					<tr>
						<td class="table-cell">{row.tenant.name}</td>
						<td class="table-cell">{row.plan.name}</td>
						<td class="table-cell"><StatusBadge value={row.subscription.status} /></td>
						<td class="table-cell text-slate-500">{new Date(row.subscription.currentPeriodEnd).toLocaleDateString('en-GB')}</td>
						<td class="table-cell text-right"><a href="/admin/tenants/{row.tenant.id}" class="text-xs text-brand-600 hover:underline">Manage</a></td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-3 py-6 text-center text-xs text-slate-400">No subscriptions yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
