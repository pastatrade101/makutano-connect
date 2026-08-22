<script lang="ts">
	import EmptyState from '$components/EmptyState.svelte';
	import FilterBar from '$components/FilterBar.svelte';
	import Pagination from '$components/Pagination.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();
	const STATUSES = [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }];
</script>

<svelte:head><title>Inbox · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Inbox</h1>
	<div class="card overflow-hidden">
		<FilterBar statuses={STATUSES} placeholder="Search conversations…" />
		{#if data.items.length === 0}
			<EmptyState title="No conversations yet" description="WhatsApp threads appear here as travellers reply." />
		{:else}
			<ul class="divide-y divide-slate-100">
				{#each data.items as row (row.conversation.id)}
					<li>
						<a href="/app/conversations/{row.conversation.id}" class="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50">
							<span class="min-w-0">
								<span class="block truncate text-sm font-medium text-slate-800">
									{[row.customer?.firstName, row.customer?.lastName].filter(Boolean).join(' ') || `+${row.conversation.externalId ?? ''}`}
								</span>
								<span class="block truncate text-[11px] text-slate-500">{row.conversation.subject ?? row.conversation.channel.toLowerCase()}</span>
							</span>
							<span class="flex shrink-0 items-center gap-2 text-[11px] text-slate-400">
								{#if row.conversation.unreadCount > 0}<span class="rounded-full bg-brand-500 px-1.5 font-semibold text-white">{row.conversation.unreadCount}</span>{/if}
								<TimeAgo value={row.conversation.lastMessageAt} timezone={data.tenant.timezone} />
							</span>
						</a>
					</li>
				{/each}
			</ul>
			<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
		{/if}
	</div>
</div>
