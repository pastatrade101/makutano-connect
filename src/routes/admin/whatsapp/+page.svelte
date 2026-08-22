<script lang="ts">
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
</script>

<svelte:head><title>WhatsApp connections · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">WhatsApp connections</h1>
	<div class="card overflow-x-auto">
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Number</th><th class="table-head">Status</th><th class="table-head">Last inbound</th><th class="table-head">Last send</th><th class="table-head">Last error</th><th class="table-head">Token expires</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.connections as c (c.id)}
					<tr>
						<td class="table-cell font-medium text-slate-800">{c.tenantName}</td>
						<td class="table-cell">
							<div>{c.displayPhoneNumber ?? '—'}</div>
							<div class="font-mono text-[11px] text-slate-400">{c.phoneNumberId}</div>
						</td>
						<td class="table-cell"><StatusBadge value={c.status} /></td>
						<td class="table-cell text-slate-500"><TimeAgo value={c.lastWebhookAt} /></td>
						<td class="table-cell text-slate-500"><TimeAgo value={c.lastSuccessfulSendAt} /></td>
						<td class="table-cell text-xs text-red-600">{c.lastErrorCode ?? '—'}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={c.tokenExpiresAt} /></td>
					</tr>
				{:else}
					<tr><td colspan="7" class="px-3 py-8 text-center text-xs text-slate-500">No WhatsApp connections yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
