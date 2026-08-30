<script lang="ts">
	// Deliberately small: a reference list so staff never retype names and prices.
	// Not inventory, not a storefront — that boundary is the product.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import { catalogCopy, catalogRecommended } from '$lib/workspace';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('catalog:write'));
	let showForm = $state(false);
	let showSync = $state(false);
	// The one source the tour operators actually have. More can be configured;
	// the form keeps to one so the common case is a single field.
	const lodges = $derived(data.sync.sources.find((x) => x.source === 'lodges') ?? null);
	const copy = $derived(catalogCopy(data.tenant.capabilities));
	// Item types ordered by what this kind of business actually adds; first = default.
	const TYPE_ORDER: Record<string, string[]> = {
		BOOKINGS: ['TOUR', 'ACCOMMODATION', 'EXPERIENCE', 'SERVICE', 'PRODUCT', 'OTHER'],
		SERVICE: ['SERVICE', 'PRODUCT', 'OTHER', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE'],
		ORDERS: ['PRODUCT', 'SERVICE', 'OTHER', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE'],
		HYBRID: ['PRODUCT', 'SERVICE', 'TOUR', 'ACCOMMODATION', 'EXPERIENCE', 'OTHER']
	};
	const types = $derived(TYPE_ORDER[data.tenant.capabilities] ?? TYPE_ORDER.HYBRID);
	const namePlaceholder = $derived(
		data.tenant.capabilities === 'BOOKINGS' ? 'Serengeti Day Trip' : data.tenant.capabilities === 'SERVICE' ? 'Website Development' : 'Nike Air Max'
	);
</script>

<svelte:head><title>{copy.label} · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Catalog updated" />

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">{copy.label}</h1>
			<p class="text-xs text-slate-400">{copy.hint}</p>
		</div>
		{#if canWrite}<button class="btn-primary" onclick={() => (showForm = !showForm)}>Add item</button>{/if}
	</div>

	{#if showForm && canWrite}
		<form method="POST" action="?/create" use:enhance={() => async ({ update }) => { await update({ reset: true }); showForm = false; }} class="card grid gap-3 p-3 sm:grid-cols-5">
			<div class="sm:col-span-2"><label class="label" for="ci-name">Name</label><input id="ci-name" name="name" placeholder={namePlaceholder} class="input" /></div>
			<div>
				<label class="label" for="ci-type">Type</label>
				<select id="ci-type" name="type" class="input">
					{#each types as t (t)}<option value={t}>{t}</option>{/each}
				</select>
			</div>
			<div><label class="label" for="ci-price">Price ({data.tenant.currency})</label><input id="ci-price" name="price" placeholder="230.00" class="input" /></div>
			<div><label class="label" for="ci-sku">SKU / ref</label><input id="ci-sku" name="sku" class="input" /></div>
			<div class="sm:col-span-4"><label class="label" for="ci-variants">Variants (comma-separated)</label><input id="ci-variants" name="variants" placeholder="Black / 42, Black / 43, White / 43" class="input" /></div>
			<div class="flex items-end"><button class="btn-primary w-full">Save</button></div>
		</form>
	{/if}

	<!-- Where this catalogue comes from, when it comes from somewhere. -->
	<div class="card p-3">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="min-w-0">
				<h2 class="text-sm font-semibold text-slate-900">Synced from your own system</h2>
				<p class="mt-0.5 text-xs text-slate-500">
					{#if lodges}
						Pulled hourly from <span class="font-mono text-[11px]">{lodges.url}</span>. Items that disappear there are
						deactivated here, never deleted.
					{:else}
						Nothing configured — this list is maintained by hand. If your website already holds these, point Connect at
						it and stop keeping the same list twice.
					{/if}
				</p>
			</div>
			{#if data.canWrite}
				<div class="flex shrink-0 gap-2">
					{#if lodges}
						<form method="POST" action="?/syncNow" use:enhance>
							<button class="btn-ghost">Sync now</button>
						</form>
					{/if}
					<button type="button" class="btn-ghost" onclick={() => (showSync = !showSync)}>
						{lodges ? 'Change' : 'Set up'}
					</button>
				</div>
			{/if}
		</div>

		{#if form?.results}
			<p class="mt-2 rounded-lg bg-success/5 px-3 py-2 text-xs text-success">
				{#each form.results as r (r.source)}
					{r.source}: {r.added} added, {r.updated} updated, {r.retired} retired.
				{/each}
			</p>
		{/if}

		{#if showSync && data.canWrite}
			<form
				method="POST"
				action="?/saveSync"
				use:enhance={() => async ({ update }) => {
					await update({ reset: false });
					showSync = false;
				}}
				class="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3"
			>
				<input type="hidden" name="source" value="lodges" />
				<input type="hidden" name="type" value="ACCOMMODATION" />
				<label class="block min-w-0 flex-1">
					<span class="label">Address of the list</span>
					<input
						name="url"
						value={lodges?.url ?? ''}
						placeholder="https://your-site.example/api/lodges"
						class="input w-full font-mono text-xs"
					/>
				</label>
				<button class="btn-primary">Save</button>
				<button type="button" class="btn-ghost" onclick={() => (showSync = false)}>Cancel</button>
				<p class="w-full text-xs text-slate-400">
					Must be a public https address. Leave it empty to stop syncing and go back to maintaining this by hand.
				</p>
			</form>
		{/if}
	</div>

	<div class="card overflow-hidden">
		<table class="mobile-record-table min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Price</th><th class="table-head">Variants</th><th class="table-head">Status</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.items as item (item.id)}
					<tr class={item.isActive ? '' : 'opacity-50'}>
					<td class="table-cell mobile-record-title">
						<div class="font-medium text-slate-700">{item.name}</div>
						{#if item.sku}<div class="font-mono text-[12.5px] text-slate-400">{item.sku}</div>{/if}
						<div class="mt-1 sm:hidden"><span class="badge {item.isActive ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'} text-xs">{item.isActive ? 'active' : 'hidden'}</span></div>
					</td>
					<td class="table-cell text-[12.5px] uppercase text-slate-400" data-label="Type">{item.type}</td>
					<td class="table-cell font-semibold" data-label="Price">{#if item.price}<Money amount={item.price} currency={item.currency ?? data.tenant.currency} />{:else}—{/if}</td>
					<td class="table-cell max-w-[14rem] text-xs text-slate-500" data-label="Variants">{(item.variants ?? []).map((v) => v.label).join(', ') || '—'}</td>
					<td class="table-cell mobile-hide" data-label="Status"><span class="badge {item.isActive ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'} text-xs">{item.isActive ? 'active' : 'hidden'}</span></td>
					<td class="table-cell mobile-record-action text-right">
							{#if canWrite}
								<form method="POST" action="?/toggle" use:enhance>
									<input type="hidden" name="id" value={item.id} />
									<input type="hidden" name="isActive" value={String(!item.isActive)} />
									<button class="text-xs text-brand-600 hover:underline">{item.isActive ? 'Hide' : 'Activate'}</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-3 py-8 text-center text-xs text-slate-400">{catalogRecommended(data.tenant.capabilities) ? 'Nothing yet — add the products or services you sell most.' : 'Nothing here, and that is fine — bookings, quotes and payments work without this list. Add an item only if it saves you retyping.'}</td></tr>
				{/each}
			</tbody>
		</table>
		<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
	</div>
</div>
