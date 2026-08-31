<script lang="ts">
	/**
	 * Categories and travel styles, side by side.
	 *
	 * They are shown together because the mistake this screen exists to prevent is
	 * confusing them: a CATEGORY is what a tour IS, a STYLE is how it is
	 * experienced. "Luxury Safari" is those two facts, not a third entry — and a
	 * taxonomy grows forty near-duplicates precisely when nobody can see both
	 * lists at once.
	 */
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';

	let { data, form } = $props();

	type Axis = 'category' | 'style';
	type Entry = (typeof data.categories)[number];

	let axis = $state<Axis>('category');
	let editing = $state<string | null>(null);
	let creating = $state(false);

	const entries = $derived(axis === 'category' ? data.categories : data.styles);
	const noun = $derived(axis === 'category' ? 'category' : 'travel style');

	const blank = (): Entry => ({
		id: '',
		name: '',
		slug: '',
		shortDescription: null,
		description: null,
		icon: null,
		isActive: true,
		isFeatured: axis === 'category',
		sortOrder: (entries.at(-1)?.sortOrder ?? 0) + 10,
		tours: 0,
		primaryFor: 0
	});

	/** A retired entry a tour still points at cannot be deleted, only reactivated. */
	const retireHint = (e: Entry) =>
		e.tours > 0
			? `${e.tours} ${e.tours === 1 ? 'tour is' : 'tours are'} filed under this. Retiring keeps them working and only removes the filter.`
			: 'Nothing is filed under this yet.';
</script>

<svelte:head><title>Taxonomy · Admin</title></svelte:head>

<FormToast {form} />

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-xl font-semibold text-slate-900">Taxonomy</h1>
		<p class="mt-1 max-w-2xl text-sm text-slate-500">
			A <strong>category</strong> is what a tour is. A <strong>travel style</strong> is how it is experienced. Keep
			both small — a list a traveller can hold in their head beats one that is technically exhaustive.
		</p>
	</div>
	<div class="inline-flex rounded-lg border border-slate-200 p-0.5">
		{#each [{ k: 'category' as const, l: 'Categories', n: data.categories.length }, { k: 'style' as const, l: 'Travel styles', n: data.styles.length }] as tab (tab.k)}
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-sm transition {axis === tab.k
					? 'bg-slate-900 text-white'
					: 'text-slate-600 hover:bg-slate-50'}"
				onclick={() => {
					axis = tab.k;
					editing = null;
					creating = false;
				}}
			>
				{tab.l}
				<span class="ml-1 opacity-60">{tab.n}</span>
			</button>
		{/each}
	</div>
</div>

<div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
	<table class="w-full text-sm">
		<thead class="border-b border-slate-200 bg-slate-50 text-left">
			<tr class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
				<th class="px-4 py-2.5">Name</th>
				<th class="px-4 py-2.5">URL</th>
				<th class="px-4 py-2.5 text-right">Tours</th>
				<th class="px-4 py-2.5 text-right">Order</th>
				<th class="px-4 py-2.5">Status</th>
				<th class="px-4 py-2.5"></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-slate-100">
			{#each entries as e (e.id)}
				<tr class:opacity-55={!e.isActive}>
					<td class="px-4 py-2.5">
						<span class="font-medium text-slate-900">{e.name}</span>
						{#if e.shortDescription}
							<span class="mt-0.5 block max-w-md text-xs text-slate-500">{e.shortDescription}</span>
						{/if}
					</td>
					<td class="px-4 py-2.5 font-mono text-xs text-slate-500">{e.slug}</td>
					<td class="px-4 py-2.5 text-right tabular-nums text-slate-600">
						{e.tours}{#if e.primaryFor}<span class="text-xs text-slate-400"> · {e.primaryFor} primary</span>{/if}
					</td>
					<td class="px-4 py-2.5 text-right tabular-nums text-slate-500">{e.sortOrder}</td>
					<td class="px-4 py-2.5">
						{#if !e.isActive}
							<span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Retired</span>
						{:else if e.isFeatured}
							<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Featured</span>
						{:else}
							<span class="text-xs text-slate-400">Active</span>
						{/if}
					</td>
					<td class="px-4 py-2.5 text-right whitespace-nowrap">
						<button type="button" class="text-xs text-slate-600 underline" onclick={() => (editing = editing === e.id ? null : e.id)}>
							{editing === e.id ? 'Close' : 'Edit'}
						</button>
						<form method="POST" action="?/setActive" use:enhance class="ml-3 inline">
							<input type="hidden" name="axis" value={axis} />
							<input type="hidden" name="id" value={e.id} />
							<input type="hidden" name="isActive" value={e.isActive ? 'false' : 'true'} />
							<button type="submit" class="text-xs text-slate-600 underline" title={retireHint(e)}>
								{e.isActive ? 'Retire' : 'Restore'}
							</button>
						</form>
					</td>
				</tr>
				{#if editing === e.id}
					<tr>
						<td colspan="6" class="bg-slate-50/70 px-4 py-4">
							<form method="POST" action="?/update" use:enhance class="grid gap-3 sm:grid-cols-2">
								<input type="hidden" name="axis" value={axis} />
								<input type="hidden" name="id" value={e.id} />
								<label class="block"><span class="label">Name</span>
									<input name="name" value={e.name} class="input" required /></label>
								<label class="block"><span class="label">URL slug</span>
									<input name="slug" value={e.slug} class="input" />
									<span class="mt-1 block text-xs text-slate-500">Changing this moves the public page.</span></label>
								<label class="block sm:col-span-2"><span class="label">Short description</span>
									<input name="shortDescription" value={e.shortDescription ?? ''} class="input" /></label>
								<label class="block sm:col-span-2"><span class="label">Description</span>
									<textarea name="description" rows="3" class="input">{e.description ?? ''}</textarea></label>
								<label class="block"><span class="label">Icon</span>
									<input name="icon" value={e.icon ?? ''} class="input" placeholder="icon_set_1_icon-44" /></label>
								<label class="block"><span class="label">Sort order</span>
									<input name="sortOrder" value={e.sortOrder} inputmode="numeric" class="input" /></label>
								<label class="flex items-center gap-2 sm:col-span-2">
									<input type="checkbox" name="isFeatured" checked={e.isFeatured} class="h-4 w-4 rounded border-slate-300" />
									<span class="text-sm text-slate-700">Show in navigation and on the home page</span>
								</label>
								<div class="sm:col-span-2"><button class="btn-primary" type="submit">Save</button></div>
							</form>
						</td>
					</tr>
				{/if}
			{:else}
				<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-slate-500">No {noun}s yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<div class="mt-4">
	{#if creating}
		<form method="POST" action="?/create" use:enhance class="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
			<input type="hidden" name="axis" value={axis} />
			<h2 class="text-sm font-semibold text-slate-900 sm:col-span-2">New {noun}</h2>
			<label class="block"><span class="label">Name</span><input name="name" class="input" required /></label>
			<label class="block"><span class="label">URL slug</span>
				<input name="slug" class="input" placeholder="left blank, made from the name" /></label>
			<label class="block sm:col-span-2"><span class="label">Short description</span><input name="shortDescription" class="input" /></label>
			<label class="block"><span class="label">Sort order</span>
				<input name="sortOrder" value={blank().sortOrder} inputmode="numeric" class="input" /></label>
			<label class="flex items-center gap-2">
				<input type="checkbox" name="isFeatured" checked={axis === 'category'} class="h-4 w-4 rounded border-slate-300" />
				<span class="text-sm text-slate-700">Show in navigation</span>
			</label>
			<div class="flex gap-2 sm:col-span-2">
				<button class="btn-primary" type="submit">Add {noun}</button>
				<button class="btn-secondary" type="button" onclick={() => (creating = false)}>Cancel</button>
			</div>
		</form>
	{:else}
		<button class="btn-secondary" type="button" onclick={() => (creating = true)}>Add a {noun}</button>
	{/if}
</div>
