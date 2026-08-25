<script lang="ts">
	import Chart from '$components/Chart.svelte';
	import { adminTheme, chartPalette } from '$lib/stores/admin-theme.svelte';
	import StatTile from '$components/StatTile.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const c = $derived(data.counts);
	const money = (currency: string, amount: number) => `${currency} ${amount.toLocaleString()}`;
	// Literal class strings — Tailwind's scanner cannot see computed names.
	const revenueCols = $derived(data.revenue.totals.length >= 2 ? 'lg:grid-cols-6' : 'lg:grid-cols-3');

	const pal = $derived(chartPalette(adminTheme.dark));
	const chartOptions = $derived({
		chart: { type: 'bar' as const, height: 230, toolbar: { show: false }, fontFamily: 'inherit', background: 'transparent' },
		series: [
			{ name: 'Messages', data: data.activity.messages },
			{ name: 'Enquiries', data: data.activity.requests },
			{ name: 'Orders', data: data.activity.orders }
		],
		xaxis: { categories: data.activity.labels, labels: { style: { colors: pal.label, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
		yaxis: { labels: { style: { colors: pal.label, fontSize: '11px' } } },
		colors: ['#1c84ee', '#7f56da', '#22c55e'],
		plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } },
		dataLabels: { enabled: false },
		grid: { borderColor: pal.grid, strokeDashArray: 4 },
		legend: { labels: { colors: pal.legend } },
		tooltip: { theme: pal.tooltip }
	});
</script>

<svelte:head><title>System health · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-base font-semibold text-slate-800">System health</h1>

	<!-- Platform -->
	<div>
		<p class="pb-1.5 text-[11.5px] font-bold uppercase tracking-widest text-slate-400">Platform</p>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			<StatTile label="Tenants" value={c.tenants} hint="{c.active_tenants} active" href="/admin/tenants" />
			<StatTile label="Suspended" value={c.suspended_tenants} tone={c.suspended_tenants ? 'bad' : 'default'} href="/admin/tenants" />
			<StatTile label="With overrides" value={c.overridden_tenants} hint="custom entitlements" href="/admin/plans" />
			<StatTile label="Active forms" value={c.active_forms} hint="{c.form_submissions} submissions" />
			<StatTile label="Approved templates" value={c.approved_templates} />
		</div>
	</div>

	<!-- Revenue — live subscriptions × current plan prices; currencies never mixed -->
	<div>
		<div class="flex items-baseline justify-between pb-1.5">
			<p class="text-[11.5px] font-bold uppercase tracking-widest text-slate-400">Revenue</p>
			<a href="/admin/plans" class="text-[12.5px] font-medium text-brand-600 hover:underline">Edit pricing →</a>
		</div>
		{#if data.revenue.totals.length}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 {revenueCols}">
				{#each data.revenue.totals as t (t.currency)}
					<StatTile label="MRR ({t.currency})" value={money(t.currency, t.mrr)} hint="{t.paying} paying · ≈ {money(t.currency, t.mrr * 12)} / yr" tone={t.mrr > 0 ? 'good' : 'default'} href="/admin/plans" />
					<StatTile label="Trial pipeline ({t.currency})" value={money(t.currency, t.trialValue)} hint="{t.trialing} on trial" />
					<StatTile label="Past due ({t.currency})" value={money(t.currency, t.pastDueValue)} tone={t.pastDueValue ? 'bad' : 'default'} />
				{/each}
			</div>
		{:else}
			<p class="card px-4 py-3 text-xs text-slate-400">No plans defined yet — create plans to start tracking revenue.</p>
		{/if}
	</div>

	<!-- Commerce + conversations -->
	<div>
		<p class="pb-1.5 text-[11.5px] font-bold uppercase tracking-widest text-slate-400">Last 24 hours</p>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
			<StatTile label="Enquiries" value={c.requests_24h} />
			<StatTile label="Orders" value={c.orders_24h} hint="{c.orders_awaiting} awaiting confirmation" tone={c.orders_awaiting ? 'warn' : 'default'} />
			<StatTile label="Messages" value={c.messages_24h} hint="{c.failed_messages_24h} failed" tone={c.failed_messages_24h ? 'warn' : 'default'} />
			<StatTile label="WhatsApp live" value={c.connections} tone="good" href="/admin/whatsapp" />
			<StatTile label="Needs re-auth" value={c.unhealthy_connections} tone={c.unhealthy_connections ? 'bad' : 'default'} href="/admin/whatsapp" />
			<StatTile label="Opted out" value={c.opted_out} hint="compliance" />
		</div>
	</div>

	<!-- Delivery -->
	<div>
		<p class="pb-1.5 text-[11.5px] font-bold uppercase tracking-widest text-slate-400">Delivery</p>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			<StatTile label="Jobs pending" value={c.jobs_pending} />
			<StatTile label="Jobs dead" value={c.jobs_dead} tone={c.jobs_dead ? 'bad' : 'default'} />
			<StatTile label="Webhooks dead" value={c.webhooks_dead} tone={c.webhooks_dead ? 'bad' : 'default'} href="/admin/errors" />
			<StatTile label="Payments failed" value={c.payments_failed} tone={c.payments_failed ? 'bad' : 'default'} href="/admin/errors" />
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<section class="card lg:col-span-2">
			<header class="card-header"><h2 class="card-title">Platform activity — last 14 days</h2></header>
			<div class="px-2 pt-2"><Chart options={chartOptions} /></div>
		</section>

		<div class="space-y-4">
			<!-- The actionable list: who is about to hit a wall -->
			<section class="card">
				<header class="card-header"><h2 class="card-title">Approaching limits</h2></header>
				<ul class="divide-y divide-slate-100">
					{#each data.nearLimit as row (row.tenantId + row.key)}
						<li class="px-4 py-2.5">
							<div class="flex items-center justify-between gap-2 text-xs">
								<a href="/admin/tenants/{row.tenantId}" class="truncate font-medium text-brand-600 hover:underline">{row.tenantName}</a>
								<span class="shrink-0 tabular-nums {row.percent >= 100 ? 'text-danger' : 'text-warning'}">{row.used}/{row.limit}</span>
							</div>
							<div class="mt-0.5 text-[12.5px] text-slate-400">{row.label}</div>
							<div class="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
								<div class="h-full rounded-full {row.percent >= 100 ? 'bg-danger' : 'bg-warning'}" style="width: {Math.min(100, row.percent)}%"></div>
							</div>
						</li>
					{:else}
						<li class="px-4 py-6 text-center text-xs text-slate-400">No tenant is near a plan limit.</li>
					{/each}
				</ul>
			</section>

			<section class="card">
				<header class="card-header"><h2 class="card-title">Plan mix</h2></header>
				<ul class="divide-y divide-slate-100">
					{#each data.planMix as p (p.code)}
						<li class="flex items-center justify-between px-4 py-2 text-sm">
							<span class="font-mono text-[12.5px] text-slate-500">{p.code}</span>
							<span class="tabular-nums font-semibold text-slate-700">{p.tenants}</span>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>

	{#if data.ai.totalRequests > 0}
		<section class="card">
			<header class="card-header">
				<h2 class="card-title">AI assist — this month</h2>
				<span class="text-[12.5px] text-slate-400">{data.ai.totalRequests} requests · est. USD {data.ai.totalCost.toFixed(2)}</span>
			</header>
			<ul class="divide-y divide-slate-100">
				{#each data.ai.tenants as row (row.tenantId)}
					<li class="flex items-center justify-between px-4 py-2 text-sm">
						<a href="/admin/tenants/{row.tenantId}" class="font-medium text-brand-600 hover:underline">{row.tenant}</a>
						<span class="tabular-nums text-slate-600">{row.requests} req · USD {row.cost.toFixed(4)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="card">
		<header class="card-header">
			<h2 class="card-title">Revenue by plan</h2>
			<a href="/admin/plans" class="text-[12.5px] font-medium text-brand-600 hover:underline">Edit pricing →</a>
		</header>
		<div class="overflow-x-auto">
			<table class="min-w-full divide-y divide-slate-100">
				<thead class="bg-slate-50"><tr>
					<th class="table-head">Plan</th><th class="table-head">Price / mo</th><th class="table-head">Paying</th>
					<th class="table-head">On trial</th><th class="table-head">Past due</th><th class="table-head text-right">MRR</th>
				</tr></thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.revenue.plans as p (p.id)}
						<tr class={p.isActive ? '' : 'opacity-50'}>
							<td class="table-cell">
								<span class="font-medium text-slate-700">{p.name}</span>
								<span class="ml-1.5 font-mono text-[11.5px] text-slate-400">{p.code}</span>
								{#if !p.isActive}<span class="ml-1.5 text-[11.5px] text-slate-400">inactive</span>{/if}
							</td>
							<td class="table-cell tabular-nums">{money(p.currency, p.price)}</td>
							<td class="table-cell tabular-nums">{p.paying}</td>
							<td class="table-cell tabular-nums text-slate-500">{p.trialing}</td>
							<td class="table-cell tabular-nums {p.pastDue ? 'text-danger' : 'text-slate-500'}">{p.pastDue}</td>
							<td class="table-cell text-right font-semibold tabular-nums text-slate-800">{money(p.currency, p.mrr)}</td>
						</tr>
					{:else}
						<tr><td colspan="6" class="px-3 py-6 text-center text-xs text-slate-400">No plans defined.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="card">
		<header class="card-header"><h2 class="card-title">Failed background jobs</h2></header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Job</th><th class="table-head">Attempts</th><th class="table-head">Error</th><th class="table-head">When</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.recentJobs as job, i (i)}
					<tr>
						<td class="table-cell font-mono text-xs">{job.kind}</td>
						<td class="table-cell tabular-nums">{job.attempts}</td>
						<td class="table-cell max-w-md truncate text-xs text-danger">{job.last_error}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={job.created_at as string} /></td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-3 py-6 text-center text-xs text-slate-400">No failed jobs.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
