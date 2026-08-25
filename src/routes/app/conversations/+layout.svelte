<script lang="ts">
	// Reback chat shell: contact list on the left, active thread on the right.
	// On mobile the list is the index page and a thread takes the full screen.
	import { page } from '$app/state';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, children } = $props();

	const inThread = $derived(page.url.pathname !== '/app/conversations');
	const activeId = $derived(page.params.id ?? null);
	let query = $state('');

	const filtered = $derived(
		data.threads.filter((t: { name: string; subject: string | null }) => {
			const q = query.trim().toLowerCase();
			return !q || t.name.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q);
		})
	);

	const initials = (name: string) =>
		name
			.replace(/^\+/, '')
			.split(/\s+/)
			.map((p: string) => p[0])
			.join('')
			.slice(0, 2)
			.toUpperCase() || '#';
</script>

<div class="flex h-[calc(100vh-10.5rem)] gap-4 lg:h-[calc(100vh-9.5rem)]">
	<!-- Thread list -->
	<aside class="{inThread ? 'hidden lg:flex' : 'flex'} w-full flex-col card lg:w-80 lg:shrink-0">
		<div class="border-b border-slate-200 p-3">
			<div class="flex items-center justify-between px-1 pb-2">
				<h2 class="text-sm font-semibold text-slate-700">Chat</h2>
				<div class="flex gap-1 text-[12.5px]">
					<a href="/app/conversations" class="rounded-full px-2.5 py-1 {data.filter === 'all' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500'}">All</a>
					<a href="/app/conversations?filter=mine" class="rounded-full px-2.5 py-1 {data.filter === 'mine' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500'}">Mine</a>
					<a href="/app/conversations?filter=unassigned" class="rounded-full px-2.5 py-1 {data.filter === 'unassigned' ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500'}">Open</a>
				</div>
			</div>
			<div class="relative">
				<input bind:value={query} placeholder="Search…" class="input bg-slate-50 py-1.5 pl-8 focus:bg-white" />
				<svg class="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" /></svg>
			</div>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#each filtered as t (t.id)}
				<a
					href="/app/conversations/{t.id}"
					class="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 transition hover:bg-slate-50 {activeId === t.id ? 'bg-brand-50/60' : ''}"
				>
					<div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[13.5px] font-bold text-brand-600">{initials(t.name)}</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline justify-between gap-2">
							<span class="truncate text-[15px] font-semibold text-slate-700">{t.name}</span>
							<span class="shrink-0 text-[12px] text-slate-400"><TimeAgo value={t.lastMessageAt} /></span>
						</div>
						<div class="flex items-center justify-between gap-2">
							<span class="truncate text-[13.5px] text-slate-400">
								{#if t.assignedToMe}<span class="mr-1 rounded bg-brand-50 px-1 text-[11.5px] font-semibold text-brand-600">mine</span>{:else if !t.assignedToUserId}<span class="mr-1 rounded bg-warning/15 px-1 text-[11.5px] font-semibold text-[#b58514]">open</span>{/if}
								{t.subject ?? t.channel.toLowerCase()}
							</span>
							{#if t.unread > 0}
								<span class="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11.5px] font-bold text-white">{t.unread}</span>
							{/if}
						</div>
					</div>
				</a>
			{:else}
				<p class="px-3 py-10 text-center text-xs text-slate-400">No conversations yet.</p>
			{/each}
		</div>
	</aside>

	<!-- Active thread / empty state -->
	<section class="{inThread ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col card">
		{@render children()}
	</section>
</div>
