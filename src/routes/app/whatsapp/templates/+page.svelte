<script lang="ts">
	// Template Center: author with named variables, submit to Meta, map to business
	// events. The event mapping is the automation — application code emits
	// ORDER_CONFIRMED and this configuration decides what the customer receives.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('whatsapp:connect'));
	let showCreate = $state(false);
	let bodyDraft = $state('Hello {{customer.first_name}}, your order {{order.number}} has been confirmed. Total: {{order.total}}.');
	let bodyEl: HTMLTextAreaElement | undefined = $state();

	function insertVariable(key: string) {
		const token = `{{${key}}}`;
		if (!bodyEl) {
			bodyDraft += token;
			return;
		}
		const start = bodyEl.selectionStart ?? bodyDraft.length;
		bodyDraft = bodyDraft.slice(0, start) + token + bodyDraft.slice(bodyEl.selectionEnd ?? start);
	}
</script>

<svelte:head><title>Template Center · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Done" />

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div>
			<a href="/app/whatsapp" class="text-xs text-slate-500 hover:underline">← WhatsApp</a>
			<h1 class="text-base font-semibold text-slate-800">Template Center</h1>
			<p class="text-xs text-slate-400">Design once with named variables · Meta approves · events send automatically.</p>
		</div>
		{#if canWrite}
			<div class="flex gap-2">
				{#if !data.templatePack.version}
					<form method="POST" action="?/setupPack" use:enhance>
						<button class="btn-primary">Set up recommended templates</button>
					</form>
				{/if}
				<form method="POST" action="?/sync" use:enhance><button class="btn-secondary">Sync from Meta</button></form>
				<button class={data.templatePack.version ? 'btn-primary' : 'btn-secondary'} onclick={() => (showCreate = !showCreate)}>New template</button>
			</div>
		{/if}
	</div>

	{#if form?.pack}
		<p class="rounded-panel bg-success/10 px-3 py-2 text-xs text-success">
			{form.pack.submitted} template{form.pack.submitted === 1 ? '' : 's'} sent to WhatsApp for approval{form.pack.skipped ? ` · ${form.pack.skipped} already existed and were left untouched` : ''}{form.pack.failed ? ` · ${form.pack.failed} could not be submitted` : ''}.
			They activate automatically once Meta approves them.
		</p>
	{/if}

	{#if showCreate && canWrite}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update({ reset: false }); }} class="card space-y-3 p-4">
			<div class="grid gap-3 sm:grid-cols-3">
				<div><label class="label" for="t-name">Name</label><input id="t-name" name="name" placeholder="order_confirmed" class="input" /></div>
				<div>
					<label class="label" for="t-lang">Language</label>
					<select id="t-lang" name="language" class="input"><option value="en">English</option><option value="sw">Swahili</option></select>
				</div>
				<div>
					<label class="label" for="t-cat">Category</label>
					<select id="t-cat" name="category" class="input"><option value="UTILITY">Utility</option><option value="MARKETING">Marketing</option></select>
				</div>
			</div>
			<div><label class="label" for="t-header">Header (optional)</label><input id="t-header" name="headerText" class="input" /></div>
			<div>
				<label class="label" for="t-body">Body</label>
				<textarea id="t-body" name="bodyText" rows="4" bind:value={bodyDraft} bind:this={bodyEl} class="input font-mono text-[13px]"></textarea>
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each data.variables as v (v.key)}
						<button type="button" class="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[10.5px] text-brand-600 hover:bg-brand-100" title={v.label} onclick={() => insertVariable(v.key)}>
							{'{{'}{v.key}{'}}'}
						</button>
					{/each}
				</div>
			</div>
			<div class="grid gap-3 sm:grid-cols-2">
				<div><label class="label" for="t-footer">Footer (optional)</label><input id="t-footer" name="footerText" class="input" /></div>
				<div>
					<label class="label" for="t-event">Send automatically on</label>
					<select id="t-event" name="eventKey" class="input">
						<option value="">— not mapped —</option>
						{#each data.events as e (e)}<option value={e}>{e.replace(/_/g, ' ')}</option>{/each}
					</select>
				</div>
			</div>
			<div>
				<label class="label" for="t-buttons">Buttons — one per line, max 3 ("Track order | https://…" for a link, plain text for quick reply)</label>
				<textarea id="t-buttons" name="buttons" rows="2" placeholder="View order | https://example.com/orders&#10;Contact us" class="input font-mono text-[13px]"></textarea>
			</div>
			<button class="btn-primary">Save draft</button>
		</form>
	{/if}

	<div class="card overflow-x-auto">
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Template</th><th class="table-head">Status</th><th class="table-head">Sends on</th><th class="table-head">Enabled</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.templates as t (t.id)}
					<tr class={t.enabled ? '' : 'opacity-60'}>
						<td class="table-cell">
							<div class="font-mono text-[13px] font-medium text-slate-700">{t.name} <span class="text-slate-400">· {t.language}</span></div>
							{#if t.bodyText}<div class="mt-0.5 max-w-md truncate text-[11px] text-slate-400">{t.bodyText}</div>{/if}
						</td>
						<td class="table-cell"><StatusBadge value={t.status} /></td>
						<td class="table-cell">
							{#if canWrite}
								<form method="POST" action="?/map" use:enhance class="flex items-center gap-1">
									<input type="hidden" name="id" value={t.id} />
									<select name="eventKey" class="input w-auto py-1 text-xs">
										<option value="">not mapped</option>
										{#each data.events as e (e)}<option value={e} selected={t.eventKey === e}>{e.replace(/_/g, ' ')}</option>{/each}
									</select>
									<button class="text-xs text-brand-600 hover:underline">Save</button>
								</form>
							{:else}
								<span class="text-xs text-slate-500">{t.eventKey ?? '—'}</span>
							{/if}
						</td>
						<td class="table-cell">
							{#if canWrite}
								<form method="POST" action="?/toggle" use:enhance>
									<input type="hidden" name="id" value={t.id} />
									<input type="hidden" name="enabled" value={String(!t.enabled)} />
									<button class="text-xs {t.enabled ? 'text-success' : 'text-slate-400'} hover:underline">{t.enabled ? 'on' : 'off'}</button>
								</form>
							{/if}
						</td>
						<td class="table-cell text-right">
							{#if canWrite && (t.status === 'DRAFT' || t.status === 'REJECTED')}
								<form method="POST" action="?/submit" use:enhance>
									<input type="hidden" name="id" value={t.id} />
									<button class="btn-primary !py-1 text-xs">Submit to Meta</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="px-3 py-8 text-center text-xs text-slate-400">No templates yet — create one, or sync existing approved templates from Meta.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<p class="text-[11px] text-slate-400">
		Free-form chat replies in the Inbox stay free-form — templates are for business-initiated notifications outside WhatsApp's 24-hour service window. Timed rules (e.g. payment reminder 48h before due) are the next layer on this same mapping.
	</p>
</div>
