<script lang="ts">
	import { sourceLabel } from '$lib/labels';
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Pagination from '$components/Pagination.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	let { data, form } = $props();
	let showForm = $state(data.openNew);
	const canWrite = $derived(data.permissions?.includes('customers:write'));
</script>

<FormToast {form} successTitle="Customer added" />

<svelte:head><title>Customers · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div><h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Customers</h1><p class="mt-0.5 text-xs text-slate-400 sm:hidden">People your team works with</p></div>
		{#if canWrite}
			<button class="btn-primary" onclick={() => (showForm = !showForm)}>New customer</button>
		{/if}
	</div>

	{#if showForm}
		<form method="POST" action="?/create" use:enhance class="card grid gap-3 p-3 sm:grid-cols-[2fr_1.5fr_1.5fr_auto]">
			<div><label class="label" for="c-name">Name</label><input id="c-name" name="name" required class="input" placeholder="Mama Daniel" /></div>
			<div><label class="label" for="c-phone">WhatsApp / phone</label><input id="c-phone" name="phone" inputmode="tel" class="input" placeholder="+255 712 345 678" /></div>
			<div><label class="label" for="c-email">Email <span class="font-normal text-slate-400">(optional)</span></label><input id="c-email" name="email" type="email" class="input" /></div>
			<div class="flex items-end"><button class="btn-primary w-full">Add</button></div>
		</form>
	{/if}
	<div class="card overflow-hidden">
		<FilterBar placeholder="Search name, email or phone…" />
		{#if data.items.length === 0}
			<EmptyState title="No customers yet" description="Customers appear here automatically when they message you on WhatsApp or send an enquiry — or add one yourself." action={{ href: '/app/customers?new=1', label: 'Add your first customer' }} />
		{:else}
			<div>
				<table class="mobile-record-table min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Email</th><th class="table-head">WhatsApp</th><th class="table-head">Country</th><th class="table-head">Source</th><th class="table-head">Added</th></tr></thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as c (c.id)}
							<tr class="hover:bg-slate-50">
								<td class="table-cell mobile-record-title font-semibold">
									<a href="/app/customers/{c.id}" class="text-brand-600 hover:underline">{[c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed customer'}</a>
								</td>
								<td class="table-cell break-all text-slate-600" data-label="Email">{c.email ?? '—'}</td>
								<td class="table-cell text-slate-600" data-label="WhatsApp">{c.whatsappPhone ? `+${c.whatsappPhone}` : '—'}</td>
								<td class="table-cell text-slate-600" data-label="Country">{c.country ?? '—'}</td>
								<td class="table-cell text-[12.5px] text-slate-500" data-label="Source">{sourceLabel(c.source)}</td>
								<td class="table-cell text-slate-500" data-label="Added"><TimeAgo value={c.createdAt} timezone={data.tenant.timezone} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
