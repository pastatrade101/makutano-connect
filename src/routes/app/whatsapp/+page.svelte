<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$app/forms';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();
	const canConnect = $derived(data.permissions?.includes('whatsapp:connect'));
	const c = $derived(data.connection);
	let settingUp = $state(false);
	const packFlavour = $derived(
		data.tenant.capabilities === 'ORDERS' ? 'order' : data.tenant.capabilities === 'SERVICE' ? 'enquiry' : 'booking'
	);
</script>

<svelte:head><title>WhatsApp · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Done" />

<div class="mx-auto max-w-5xl space-y-3">
	<h1 class="text-base font-semibold text-slate-900">WhatsApp</h1>

	{#if !data.featureEnabled}
		<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-[#b58514]">WhatsApp is not included in your current plan.</p>
	{/if}

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">Connection</h2>
			{#if c}<StatusBadge value={c.status} />{/if}
		</header>

		{#if c && c.status === 'CONNECTED'}
			{#if !data.templatePack.version && canConnect}
				<!-- Finish setup: one tap submits the workspace's notification pack -->
				<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-brand-50/50 px-4 py-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold text-slate-800">Finish WhatsApp setup</p>
						<p class="text-xs text-slate-500">
							We'll prepare the recommended {packFlavour} notifications for your business and send them to WhatsApp for approval — usually done within hours.
						</p>
					</div>
					<form method="POST" action="?/setupTemplates" use:enhance={() => { settingUp = true; return async ({ update }) => { await update(); settingUp = false; }; }}>
						<button class="btn-primary" disabled={settingUp}>{settingUp ? 'Setting up…' : 'Set up notifications'}</button>
					</form>
				</div>
			{:else if form?.pack}
				<p class="border-b border-slate-100 bg-success/5 px-4 py-2.5 text-xs text-success">
					{form.pack.submitted} notification template{form.pack.submitted === 1 ? '' : 's'} sent to WhatsApp for approval{form.pack.skipped ? ` · ${form.pack.skipped} already existed` : ''}.
					They switch on automatically once approved — track them under Message templates.
				</p>
			{/if}
			<dl class="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-3">
				<div><dt class="text-[11px] uppercase text-slate-500">Number</dt><dd class="font-medium">{c.displayPhoneNumber ?? '—'}</dd></div>
				<div><dt class="text-[11px] uppercase text-slate-500">Business</dt><dd>{c.businessName ?? '—'}</dd></div>
				<div><dt class="text-[11px] uppercase text-slate-500">Connected</dt><dd><TimeAgo value={c.connectedAt} timezone={data.tenant.timezone} /></dd></div>
				<div><dt class="text-[11px] uppercase text-slate-500">Last inbound</dt><dd><TimeAgo value={c.lastWebhookAt} timezone={data.tenant.timezone} /></dd></div>
				<div><dt class="text-[11px] uppercase text-slate-500">Last send</dt><dd><TimeAgo value={c.lastSuccessfulSendAt} timezone={data.tenant.timezone} /></dd></div>
				<div><dt class="text-[11px] uppercase text-slate-500">Last error</dt><dd class="text-danger">{c.lastErrorCode ?? '—'}</dd></div>
			</dl>
			{#if canConnect}
				<div class="flex gap-2 border-t border-slate-200 p-3">
					<a href="/connect/whatsapp" class="btn-secondary">Reconnect</a>
					<form method="POST" action="?/disconnect" use:enhance><button class="btn-danger">Disconnect</button></form>
				</div>
			{/if}
		{:else}
			<div class="p-4 text-center">
				<p class="text-sm text-slate-700">{c ? 'This connection needs attention.' : 'No WhatsApp number is connected.'}</p>
				<p class="mx-auto mt-1 max-w-sm text-xs text-slate-500">
					You keep ownership of your WhatsApp Business Account and number; Makutano operates the connection on your behalf.
				</p>
				{#if canConnect && data.signupReady}
					<a href="/connect/whatsapp" class="btn-primary mt-3">Connect WhatsApp</a>
				{:else if !data.signupReady}
					<p class="mt-3 text-xs text-[#b58514]">Embedded Signup is not configured on this deployment.</p>
				{/if}
			</div>
		{/if}
	</section>

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">Message templates <a href="/app/whatsapp/templates" class="ml-2 text-xs font-medium text-brand-600 hover:underline">Open Template Center →</a></h2>
			{#if canConnect}
				<form method="POST" action="?/sync" use:enhance><button class="btn-secondary">Sync from Meta</button></form>
			{/if}
		</header>
		{#if data.templates.length === 0}
			<p class="px-3 py-6 text-center text-xs text-slate-500">No templates synced yet.</p>
		{:else}
			<table class="min-w-full divide-y divide-slate-100">
				<thead class="bg-slate-50"><tr><th class="table-head">Template</th><th class="table-head">Language</th><th class="table-head">Status</th><th class="table-head">Used for</th></tr></thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.templates as t (t.id)}
						<tr>
							<td class="table-cell font-medium text-slate-800">{t.name}</td>
							<td class="table-cell text-slate-600">{t.language}</td>
							<td class="table-cell"><StatusBadge value={t.status} /></td>
							<td class="table-cell">
								{#if canConnect}
									<form method="POST" action="?/mapTemplate" use:enhance class="flex items-center gap-1">
										<input type="hidden" name="templateId" value={t.id} />
										<select name="eventKey" class="input w-auto py-1 text-xs">
											<option value="">Not mapped</option>
											{#each data.templateEvents as e (e)}<option value={e} selected={t.eventKey === e}>{e.replace(/_/g, ' ')}</option>{/each}
										</select>
										<button class="text-xs text-brand-600 hover:underline">Save</button>
									</form>
								{:else}
									<span class="text-xs text-slate-500">{t.eventKey ?? '—'}</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</div>
