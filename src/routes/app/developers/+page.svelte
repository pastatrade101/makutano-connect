<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('api_keys:write'));
	const canHooks = $derived(data.permissions?.includes('webhooks:write'));
	let showKeyForm = $state(false);
	let showHookForm = $state(false);
</script>

<svelte:head><title>Developers · {data.tenant.name}</title></svelte:head>

<div class="max-w-4xl space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Developers</h1>

	{#if form?.message}<p class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{form.message}</p>{/if}

	<section class="card p-3">
		<h2 class="text-sm font-semibold text-slate-800">Connect your website</h2>
		<p class="mt-1 text-xs text-slate-500">Store these on your website's <b>server</b>. The secret key must never reach a browser.</p>
		<pre class="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100"><code>MAKUTANO_API_URL={data.apiBaseUrl}
MAKUTANO_API_KEY=mk_live_••••••••</code></pre>
		<pre class="mt-2 overflow-x-auto rounded-md bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200"><code>curl -X POST "{data.apiBaseUrl}/api/v1/booking-requests" \
  -H "Authorization: Bearer $MAKUTANO_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '&#123;"customer":&#123;"firstName":"Amina","whatsappPhone":"255712345678"&#125;,
       "adults":2,"items":[&#123;"title":"3-day Serengeti","externalReference":"serengeti-3d"&#125;]&#125;'</code></pre>
	</section>

	{#if form?.createdKey}
		<div class="rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-200">
			<p class="text-xs font-semibold text-emerald-900">Copy this key now — it is shown only once.</p>
			<code class="mt-1 block overflow-x-auto rounded bg-white px-2 py-1 font-mono text-xs text-slate-900 ring-1 ring-emerald-200">{form.createdKey.secret}</code>
		</div>
	{/if}

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">API keys</h2>
			{#if canWrite}<button class="btn-secondary" onclick={() => (showKeyForm = !showKeyForm)}>New key</button>{/if}
		</header>

		{#if showKeyForm && canWrite}
			<form method="POST" action="?/createKey" use:enhance={() => async ({ update }) => { await update(); showKeyForm = false; }} class="space-y-3 border-b border-slate-100 bg-slate-50 p-3">
				<div class="flex flex-wrap gap-2">
					<div class="flex-1"><label class="label" for="key-name">Name</label><input id="key-name" name="name" placeholder="Website integration" class="input" /></div>
					<div><label class="label" for="key-env">Environment</label><select id="key-env" name="environment" class="input w-auto"><option value="live">Live</option><option value="test">Test</option></select></div>
				</div>
				<div>
					<span class="label">Scopes</span>
					<div class="grid grid-cols-2 gap-1 sm:grid-cols-3">
						{#each data.scopes as scope (scope)}
							<label class="flex items-center gap-1.5 text-xs text-slate-600">
								<input type="checkbox" name="scopes" value={scope} checked={data.defaultScopes.includes(scope)} class="rounded border-slate-300" />
								<span class="font-mono">{scope}</span>
							</label>
						{/each}
					</div>
				</div>
				<button class="btn-primary">Create key</button>
			</form>
		{/if}

		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Key</th><th class="table-head">Env</th><th class="table-head">Status</th><th class="table-head">Last used</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.keys as key (key.id)}
					<tr>
						<td class="table-cell font-medium text-slate-800">{key.name}</td>
						<td class="table-cell font-mono text-xs text-slate-500">{key.prefix}…</td>
						<td class="table-cell text-[11px] uppercase text-slate-500">{key.environment}</td>
						<td class="table-cell"><StatusBadge value={key.status} /></td>
						<td class="table-cell text-slate-500"><TimeAgo value={key.lastUsedAt} timezone={data.tenant.timezone} /></td>
						<td class="table-cell text-right">
							{#if canWrite && key.status === 'ACTIVE'}
								<form method="POST" action="?/revokeKey" use:enhance>
									<input type="hidden" name="id" value={key.id} />
									<button class="text-xs text-red-600 hover:underline">Revoke</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-3 py-6 text-center text-xs text-slate-500">No API keys yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>

	{#if form?.createdEndpoint}
		<div class="rounded-md bg-emerald-50 p-3 ring-1 ring-emerald-200">
			<p class="text-xs font-semibold text-emerald-900">Signing secret — shown once. Verify every delivery with it.</p>
			<code class="mt-1 block overflow-x-auto rounded bg-white px-2 py-1 font-mono text-xs ring-1 ring-emerald-200">{form.createdEndpoint.secret}</code>
		</div>
	{/if}

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">Webhook endpoints</h2>
			{#if canHooks}<button class="btn-secondary" onclick={() => (showHookForm = !showHookForm)}>Add endpoint</button>{/if}
		</header>

		{#if showHookForm && canHooks}
			<form method="POST" action="?/createEndpoint" use:enhance={() => async ({ update }) => { await update(); showHookForm = false; }} class="space-y-3 border-b border-slate-100 bg-slate-50 p-3">
				<div><label class="label" for="hook-url">Endpoint URL (HTTPS)</label><input id="hook-url" name="url" placeholder="https://example.com/hooks/makutano" class="input" /></div>
				<div>
					<span class="label">Events (none selected = all)</span>
					<div class="grid grid-cols-2 gap-1 sm:grid-cols-3">
						{#each data.events as e (e)}
							<label class="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="events" value={e} class="rounded border-slate-300" /><span class="font-mono">{e}</span></label>
						{/each}
					</div>
				</div>
				<button class="btn-primary">Add endpoint</button>
			</form>
		{/if}

		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">URL</th><th class="table-head">Events</th><th class="table-head">Failures</th><th class="table-head">Last success</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.endpoints as ep (ep.id)}
					<tr>
						<td class="table-cell max-w-xs truncate font-mono text-xs">{ep.url}</td>
						<td class="table-cell text-[11px] text-slate-500">{ep.events.length ? ep.events.join(', ') : 'all'}</td>
						<td class="table-cell tabular-nums {ep.consecutiveFailures > 0 ? 'text-red-600' : 'text-slate-500'}">{ep.consecutiveFailures}</td>
						<td class="table-cell text-slate-500"><TimeAgo value={ep.lastSuccessAt} timezone={data.tenant.timezone} /></td>
						<td class="table-cell text-right">
							{#if canHooks}
								<form method="POST" action="?/deleteEndpoint" use:enhance>
									<input type="hidden" name="id" value={ep.id} />
									<button class="text-xs text-red-600 hover:underline">Delete</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-3 py-6 text-center text-xs text-slate-500">No webhook endpoints configured.</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
