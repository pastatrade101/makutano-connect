<script lang="ts">
	import Chart from '$components/Chart.svelte';
	import StatTile from '$components/StatTile.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const c = $derived(data.counts);

	const chartOptions = $derived({
		chart: { type: 'bar' as const, height: 230, toolbar: { show: false }, fontFamily: 'inherit', stacked: false },
		series: [
			{ name: 'Messages', data: data.activity.messages },
			{ name: 'Enquiries', data: data.activity.requests }
		],
		xaxis: { categories: data.activity.labels, labels: { style: { colors: '#8486a7', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
		yaxis: { labels: { style: { colors: '#8486a7', fontSize: '11px' } } },
		colors: ['#1c84ee', '#7f56da'],
		plotOptions: { bar: { columnWidth: '45%', borderRadius: 3 } },
		dataLabels: { enabled: false },
		grid: { borderColor: '#eaedf1', strokeDashArray: 4 },
		legend: { labels: { colors: '#5d7186' } }
	});
</script>

<svelte:head><title>System health · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<h1 class="text-base font-semibold text-slate-900">System health</h1>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
		<StatTile label="Tenants" value={c.tenants} hint="{c.active_tenants} active" href="/admin/tenants" />
		<StatTile label="WhatsApp live" value={c.connections} tone="good" href="/admin/whatsapp" />
		<StatTile label="Needs re-auth" value={c.unhealthy_connections} tone={c.unhealthy_connections ? 'bad' : 'default'} href="/admin/whatsapp" />
		<StatTile label="Requests 24h" value={c.requests_24h} />
		<StatTile label="Messages 24h" value={c.messages_24h} hint="{c.failed_messages_24h} failed" tone={c.failed_messages_24h ? 'warn' : 'default'} />
		<StatTile label="Bookings" value={c.bookings} />
	</div>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Jobs pending" value={c.jobs_pending} />
		<StatTile label="Jobs dead" value={c.jobs_dead} tone={c.jobs_dead ? 'bad' : 'default'} />
		<StatTile label="Webhooks dead" value={c.webhooks_dead} tone={c.webhooks_dead ? 'bad' : 'default'} href="/admin/errors" />
		<StatTile label="Payments failed" value={c.payments_failed} tone={c.payments_failed ? 'bad' : 'default'} href="/admin/errors" />
	</div>

	<section class="card">
		<header class="card-header"><h2 class="card-title">Platform activity — last 14 days</h2></header>
		<div class="px-2 pt-2"><Chart options={chartOptions} /></div>
	</section>

	<section class="card">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Failed background jobs</header>
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
					<tr><td colspan="4" class="px-3 py-6 text-center text-xs text-slate-500">No failed jobs. </td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
