<script lang="ts">
	// Connection health for operators. Shows everything needed to diagnose delivery —
	// and no secret: the access token is reported only as "stored", never rendered.
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();
	const c = $derived(data.connection);
	let confirming = $state(false);

	const webhookHealthy = $derived(!!c.lastWebhookAt && Date.now() - new Date(c.lastWebhookAt).getTime() < 7 * 86400000);
</script>

<svelte:head><title>{c.displayPhoneNumber ?? c.phoneNumberId} · WhatsApp</title></svelte:head>

<FormToast {form} successTitle="Done" />

<div class="max-w-4xl space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div>
			<a href="/admin/whatsapp" class="text-xs text-slate-500 hover:underline">← WhatsApp connections</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-800">
				{c.displayPhoneNumber ?? c.phoneNumberId}
				<StatusBadge value={c.status} />
				{#if c.isPrimary}<span class="badge bg-brand-50 text-brand-600">primary</span>{/if}
			</h1>
			<p class="text-[11px] text-slate-400">
				{c.businessName ?? '—'} · tenant <a href="/admin/tenants/{data.tenant.id}" class="text-brand-600 hover:underline">{data.tenant.name}</a>
			</p>
		</div>
		<div class="flex gap-2">
			<form method="POST" action="?/syncTemplates" use:enhance><button class="btn-secondary !py-1.5 text-xs">Sync templates</button></form>
			{#if c.status === 'CONNECTED'}
				{#if confirming}
					<form method="POST" action="?/disable" use:enhance={() => async ({ update }) => { await update(); confirming = false; }} class="flex items-center gap-2 rounded-panel border border-danger/30 bg-danger/5 p-1.5">
						<input name="reason" placeholder="Reason (audited)" class="input w-44 py-1 text-xs" />
						<button class="btn-danger !py-1 text-xs">Confirm disable</button>
						<button type="button" class="text-xs text-slate-500" onclick={() => (confirming = false)}>Cancel</button>
					</form>
				{:else}
					<button class="btn-danger !py-1.5 text-xs" onclick={() => (confirming = true)}>Disable connection</button>
				{/if}
			{/if}
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<section class="card">
			<header class="card-header"><h2 class="card-title">Meta identifiers</h2></header>
			<dl class="space-y-2 p-4 text-sm">
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Phone number ID</dt><dd class="font-mono text-xs">{c.phoneNumberId}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">WABA ID</dt><dd class="font-mono text-xs">{c.wabaId ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Business ID</dt><dd class="font-mono text-xs">{c.metaBusinessId ?? '—'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Connected</dt><dd><TimeAgo value={c.connectedAt} /></dd></div>
				{#if c.disconnectedAt}
					<div class="flex justify-between gap-3"><dt class="text-slate-500">Disconnected</dt><dd><TimeAgo value={c.disconnectedAt} /></dd></div>
				{/if}
			</dl>
		</section>

		<section class="card">
			<header class="card-header"><h2 class="card-title">Credential health</h2></header>
			<dl class="space-y-2 p-4 text-sm">
				<div class="flex justify-between gap-3">
					<dt class="text-slate-500">Access token</dt>
					<dd>{#if c.credentialStored}<span class="badge bg-success/10 text-success">stored, encrypted</span>{:else}<span class="badge bg-danger/10 text-danger">missing</span>{/if}</dd>
				</div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Key version</dt><dd class="tabular-nums">v{c.keyVersion}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Token expires</dt><dd>{c.tokenExpiresAt ? new Date(c.tokenExpiresAt).toLocaleDateString('en-GB') : 'never (system user)'}</dd></div>
				<div class="flex justify-between gap-3"><dt class="text-slate-500">Last error</dt><dd class="text-danger">{c.lastErrorCode ?? '—'}{#if c.lastErrorAt} · <TimeAgo value={c.lastErrorAt} />{/if}</dd></div>
				<p class="pt-1 text-[11px] text-slate-400">Token values are never displayed or logged — only their presence and expiry.</p>
			</dl>
		</section>

		<section class="card">
			<header class="card-header"><h2 class="card-title">Traffic (7 days)</h2></header>
			<div class="grid grid-cols-3 gap-2 p-4 text-center">
				<div><div class="text-lg font-bold tabular-nums text-slate-800">{data.messages.in_7d ?? 0}</div><div class="text-[10px] uppercase text-slate-500">inbound</div></div>
				<div><div class="text-lg font-bold tabular-nums text-slate-800">{data.messages.out_7d ?? 0}</div><div class="text-[10px] uppercase text-slate-500">outbound</div></div>
				<div><div class="text-lg font-bold tabular-nums {(data.messages.failed_7d ?? 0) > 0 ? 'text-danger' : 'text-slate-800'}">{data.messages.failed_7d ?? 0}</div><div class="text-[10px] uppercase text-slate-500">failed</div></div>
			</div>
			<div class="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
				<div class="flex justify-between"><span class="text-slate-500">Last inbound</span><TimeAgo value={c.lastWebhookAt} /></div>
				<div class="flex justify-between"><span class="text-slate-500">Last successful send</span><TimeAgo value={c.lastSuccessfulSendAt} /></div>
				<div class="flex justify-between">
					<span class="text-slate-500">Webhook health</span>
					<span class="badge {webhookHealthy ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'} text-xs">{webhookHealthy ? 'receiving' : 'no recent inbound'}</span>
				</div>
			</div>
		</section>

		<section class="card">
			<header class="card-header"><h2 class="card-title">Templates</h2></header>
			<dl class="space-y-2 p-4 text-sm">
				<div class="flex justify-between"><dt class="text-slate-500">Registered</dt><dd class="tabular-nums">{data.templates.total ?? 0}</dd></div>
				<div class="flex justify-between"><dt class="text-slate-500">Approved by Meta</dt><dd class="tabular-nums">{data.templates.approved ?? 0}</dd></div>
				<div class="flex justify-between"><dt class="text-slate-500">Last synced</dt><dd><TimeAgo value={data.templates.last_synced as string} /></dd></div>
				<p class="pt-1 text-[11px] text-slate-400">Approval is Meta's decision — Connect mirrors it and refuses to send unapproved templates.</p>
			</dl>
		</section>
	</div>
</div>
