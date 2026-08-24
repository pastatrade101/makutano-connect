<script lang="ts">
	// Deliberately small: a reference list so staff never retype names and prices.
	// Not inventory, not a storefront — that boundary is the product.
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	import Pagination from '$components/Pagination.svelte';
	import { catalogCopy, catalogRecommended } from '$lib/workspace';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('catalog:write'));
	let showForm = $state(false);
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
			<h1 class="text-base font-semibold text-slate-800">{copy.label}</h1>
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

	<div class="card overflow-x-auto">
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Item</th><th class="table-head">Type</th><th class="table-head">Price</th><th class="table-head">Variants</th><th class="table-head">Status</th><th class="table-head"></th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.items as item (item.id)}
					<tr class={item.isActive ? '' : 'opacity-50'}>
						<td class="table-cell">
							<div class="font-medium text-slate-700">{item.name}</div>
							{#if item.sku}<div class="font-mono text-[11px] text-slate-400">{item.sku}</div>{/if}
						</td>
						<td class="table-cell text-[11px] uppercase text-slate-400">{item.type}</td>
						<td class="table-cell">{#if item.price}<Money amount={item.price} currency={item.currency ?? data.tenant.currency} />{:else}—{/if}</td>
						<td class="table-cell max-w-[14rem] truncate text-xs text-slate-500">{(item.variants ?? []).map((v) => v.label).join(', ') || '—'}</td>
						<td class="table-cell"><span class="badge {item.isActive ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'} text-xs">{item.isActive ? 'active' : 'hidden'}</span></td>
						<td class="table-cell text-right">
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
