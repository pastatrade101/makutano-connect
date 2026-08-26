<script lang="ts">
	import { moduleRelevant } from '$lib/workspace';
	// Forms & Widgets — the no-code intake manager. Compact by design: list on top,
	// one expandable editor per form. Copy the hosted URL or the one-line embed.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import { toasts } from '$lib/stores/toast.svelte';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('forms:write'));

	let showCreate = $state(false);
	let editing = $state<string | null>(null);

	$effect(() => {
		if (form && 'editId' in form && form.editId) editing = form.editId as string;
	});

	function copy(text: string, label: string) {
		void navigator.clipboard.writeText(text).then(() => toasts.success(label));
	}
	const hostedUrl = (publicId: string) => `${data.baseUrl}/f/${publicId}`;
	const embedCode = (publicId: string) => `<script src="${data.baseUrl}/widget.js" data-widget="${publicId}"><\/script>`;
</script>

<svelte:head><title>Forms & Widgets · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Form saved" />

<div class="space-y-3">
	<div class="flex items-start justify-between gap-3">
		<div>
			<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Forms & Widgets</h1>
			<p class="text-xs text-slate-400">Hosted pages and embeddable widgets that feed enquiries, orders and leads straight into Connect.</p>
		</div>
		{#if canWrite}<button class="btn-primary" onclick={() => (showCreate = !showCreate)}>New form</button>{/if}
	</div>

	{#if showCreate && canWrite}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update({ reset: true }); showCreate = false; }} class="card grid gap-3 p-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto] sm:items-end">
			<div><label class="label" for="nf-name">Name</label><input id="nf-name" name="name" placeholder="Website booking form" class="input" /></div>
			<div>
				<label class="label" for="nf-type">Template</label>
				<select id="nf-type" name="type" class="input sm:w-auto">
					{#if moduleRelevant(data.tenant.capabilities, 'enquiries')}<option value="BOOKING">Booking enquiry</option>{/if}
					{#if moduleRelevant(data.tenant.capabilities, 'orders')}<option value="ORDER">Product order</option>{/if}
					{#if moduleRelevant(data.tenant.capabilities, 'quotations')}<option value="QUOTE">Quote request</option>{/if}
					<option value="LEAD">Contact / lead</option>
				</select>
			</div>
			<button class="btn-primary w-full">Create</button>
		</form>
	{/if}

	{#each data.forms as f (f.id)}
		<section class="card">
			<header class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
				<div class="flex items-center gap-2">
					<h2 class="text-sm font-semibold text-slate-700">{f.name}</h2>
					<span class="badge bg-slate-100 text-[11.5px] uppercase text-slate-500">{f.type}</span>
					<StatusBadge value={f.isActive ? 'ACTIVE' : 'DISCONNECTED'} size="xs" />
					<span class="text-[12.5px] text-slate-400">{f.submissionCount} submissions</span>
				</div>
				<div class="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:items-center">
					<a href={hostedUrl(f.publicId)} target="_blank" rel="noopener" class="btn-secondary !py-1 text-xs">Preview</a>
					<button class="btn-secondary !py-1 text-xs" onclick={() => copy(hostedUrl(f.publicId), 'Hosted URL copied')}>Copy URL</button>
					<button class="btn-secondary !py-1 text-xs" onclick={() => copy(embedCode(f.publicId), 'Embed code copied')}>Copy embed</button>
					{#if canWrite}
						<button class="btn-secondary !py-1 text-xs" onclick={() => (editing = editing === f.id ? null : f.id)}>{editing === f.id ? 'Close' : 'Configure'}</button>
					{/if}
				</div>
			</header>

			{#if editing === f.id && canWrite}
				<form method="POST" action="?/save" use:enhance class="space-y-3 border-t border-slate-100 bg-slate-50/60 p-4">
					<input type="hidden" name="id" value={f.id} />
					<div class="grid gap-3 sm:grid-cols-2">
						<div><label class="label" for="fe-name-{f.id}">Internal name</label><input id="fe-name-{f.id}" name="name" value={f.name} class="input" /></div>
						<div><label class="label" for="fe-accent-{f.id}">Accent colour</label><input id="fe-accent-{f.id}" name="accentColor" value={String((f.branding ?? {}).accentColor ?? '#1c84ee')} class="input" /></div>
						<div><label class="label" for="fe-heading-{f.id}">Heading</label><input id="fe-heading-{f.id}" name="heading" value={f.heading ?? ''} class="input" /></div>
						<div><label class="label" for="fe-cta-{f.id}">Button text</label><input id="fe-cta-{f.id}" name="ctaText" value={f.ctaText ?? ''} class="input" /></div>
						<div class="sm:col-span-2"><label class="label" for="fe-desc-{f.id}">Description</label><input id="fe-desc-{f.id}" name="description" value={f.description ?? ''} class="input" /></div>
						<div class="sm:col-span-2"><label class="label" for="fe-success-{f.id}">Success message</label><input id="fe-success-{f.id}" name="successMessage" value={f.successMessage ?? ''} class="input" /></div>
					</div>

					<div>
						<span class="label">Fields</span>
						<div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
							{#each data.fieldCatalog[f.type] as def (def.key)}
								<div class="flex items-center justify-between rounded-panel border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
									<label class="flex items-center gap-2">
										<input type="checkbox" name="field_{def.key}" checked={f.fields[def.key]?.enabled ?? false} class="rounded border-slate-300" />
										<span class="text-slate-600">{def.label}</span>
									</label>
									<label class="flex items-center gap-1 text-slate-400">
										<input type="checkbox" name="required_{def.key}" checked={f.fields[def.key]?.required ?? false} class="rounded border-slate-300" />
										required
									</label>
								</div>
							{/each}
						</div>
					</div>

					{#if (f.type === 'ORDER' || f.type === 'BOOKING') && data.catalog.length}
						<div>
							<span class="label">Offer catalog items (optional)</span>
							<div class="grid grid-cols-1 gap-1 sm:grid-cols-3">
								{#each data.catalog as c (c.id)}
									<label class="flex items-center gap-2 rounded-panel border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600">
										<input type="checkbox" name="catalogItemIds" value={c.id} checked={(f.catalogItemIds ?? []).includes(c.id)} class="rounded border-slate-300" />
										{c.name}
									</label>
								{/each}
							</div>
						</div>
					{/if}

					<div>
						<label class="label" for="fe-origins-{f.id}">Allowed embed domains (one per line; empty = any)</label>
						<textarea id="fe-origins-{f.id}" name="allowedOrigins" rows="2" placeholder="example.com" class="input">{(f.allowedOrigins ?? []).join('\n')}</textarea>
					</div>

					<div class="grid gap-2 sm:flex sm:items-center sm:justify-between">
						<div class="flex gap-2">
							<button class="btn-primary">Save form</button>
						</div>
						<div class="grid grid-cols-2 gap-2 sm:flex">
							<button formaction="?/toggle" name="isActive" value={String(!f.isActive)} class="btn-secondary">{f.isActive ? 'Disable' : 'Enable'}</button>
							<button formaction="?/regenerate" class="btn-danger" title="Invalidates every published URL and embed">Regenerate ID</button>
						</div>
					</div>
				</form>
			{/if}
		</section>
	{:else}
		<div class="card p-8 text-center text-xs text-slate-400">No forms yet — create one and share its hosted URL or embed it on any website.</div>
	{/each}
</div>
