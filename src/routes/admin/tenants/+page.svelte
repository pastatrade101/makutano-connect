<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();
	let showForm = $state(false);
</script>

<svelte:head><title>Tenants · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-semibold text-slate-900">Tenants</h1>
		<button class="btn-primary" onclick={() => (showForm = !showForm)}>Provision tenant</button>
	</div>

	{#if form?.message}<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>{/if}

	{#if form?.created}
		<div class="rounded-panel border border-success/30 bg-success/10 p-3">
			<p class="text-sm font-semibold text-success">{form.created.name} is live.</p>
			<p class="mt-1 text-xs text-success">Copy these now — they are shown only once.</p>
			<dl class="mt-2 space-y-1 text-xs">
				<div><dt class="inline font-medium">API key: </dt><dd class="inline font-mono">{form.created.apiKey}</dd></div>
				{#if form.created.ownerEmail}
					<div><dt class="inline font-medium">Owner: </dt><dd class="inline font-mono">{form.created.ownerEmail}</dd></div>
				{/if}
				{#if form.created.temporaryPassword}
					<div><dt class="inline font-medium">Temporary password: </dt><dd class="inline font-mono">{form.created.temporaryPassword}</dd></div>
				{/if}
			</dl>
		</div>
	{/if}

	{#if showForm}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update({ reset: true }); showForm = false; }} class="card grid gap-3 p-3 sm:grid-cols-3">
			<div><label class="label" for="t-name">Business name</label><input id="t-name" name="name" placeholder="Emnel Adventures" class="input" /></div>
			<div><label class="label" for="t-slug">Slug</label><input id="t-slug" name="slug" placeholder="emnel" class="input" /></div>
			<div>
				<label class="label" for="t-plan">Plan</label>
				<select id="t-plan" name="planCode" class="input">
					{#each data.plans as p (p.code)}<option value={p.code}>{p.name}</option>{/each}
				</select>
			</div>
			<div><label class="label" for="t-owner">Owner email (optional)</label><input id="t-owner" name="ownerEmail" type="email" class="input" /></div>
			<div><label class="label" for="t-country">Country</label><input id="t-country" name="country" maxlength="2" placeholder="TZ" class="input" /></div>
			<div><label class="label" for="t-currency">Currency</label><input id="t-currency" name="currency" maxlength="3" value="USD" class="input" /></div>
			<div><label class="label" for="t-tz">Timezone</label><input id="t-tz" name="timezone" value="Africa/Dar_es_Salaam" class="input" /></div>
			<div><label class="label" for="t-prefix">Reference prefix</label><input id="t-prefix" name="prefix" placeholder="EMN" class="input" /></div>
			<div class="flex items-end"><button class="btn-primary w-full">Create tenant</button></div>
		</form>
	{/if}

	<div class="card overflow-hidden">
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Tenant</th><th class="table-head">Plan</th><th class="table-head">Status</th><th class="table-head">WhatsApp</th><th class="table-head">Requests</th><th class="table-head">Created</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.tenants as row (row.tenant.id)}
					<tr class="hover:bg-slate-50">
						<td class="table-cell">
							<div class="font-medium text-slate-800">{row.tenant.name}</div>
							<div class="font-mono text-[11px] text-slate-500">{row.tenant.slug}</div>
						</td>
						<td class="table-cell text-slate-600">{row.plan?.name ?? '—'}</td>
						<td class="table-cell"><StatusBadge value={row.tenant.status} /></td>
						<td class="table-cell">{#if row.whatsapp}<StatusBadge value={row.whatsapp} size="xs" />{:else}<span class="text-xs text-slate-400">—</span>{/if}</td>
						<td class="table-cell tabular-nums">{row.requests}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={row.tenant.createdAt} /></td>
						<td class="table-cell text-right">
							<form method="POST" action="?/openPortal" class="mb-1 inline-block">
								<input type="hidden" name="id" value={row.tenant.id} />
								<button class="text-xs text-brand-600 hover:underline">Open portal</button>
							</form>
							<form method="POST" action="?/setStatus" use:enhance class="inline-flex items-center gap-1">
								<input type="hidden" name="id" value={row.tenant.id} />
								<select name="status" class="input w-auto py-1 text-xs">
									{#each ['ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED'] as s (s)}<option value={s} selected={row.tenant.status === s}>{s}</option>{/each}
								</select>
								<button class="text-xs text-brand-600 hover:underline">Set</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
