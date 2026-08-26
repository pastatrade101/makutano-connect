<script lang="ts">
	// Reback chat shell: contact list on the left, active thread on the right.
	// On mobile the list is the index page and a thread takes the full screen.
	import { page } from '$app/state';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, children } = $props();

	const inThread = $derived(page.url.pathname !== '/app/conversations');
	const activeId = $derived(page.params.id ?? null);
	let query = $state('');

	type Thread = { name: string; subject: string | null };
	const filtered = $derived(
		data.threads.filter((t: Thread) => {
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

<div class="flex min-h-0 flex-1 gap-0 lg:gap-4">
	<!-- Thread list -->
	<aside class="{inThread ? 'hidden lg:flex' : 'flex'} min-h-0 w-full flex-col overflow-hidden border-y border-slate-200 bg-white lg:w-80 lg:shrink-0 lg:rounded-panel lg:border lg:shadow-panel">
		<div class="shrink-0 border-b border-slate-200 bg-white px-3 pt-3 pb-2 lg:p-3">
			<div class="flex items-center justify-between px-1 pb-3">
				<h2 class="text-xl font-bold tracking-tight wa-text lg:text-sm lg:font-semibold lg:text-slate-700">Chats</h2>
				<div class="flex gap-1 text-[12px]">
					<a href="/app/conversations" class="rounded-full px-3 py-1.5 font-medium {data.filter === 'all' ? 'bg-[#e7fce9] text-[#008069]' : 'bg-slate-100 text-slate-500'}">All</a>
					<a href="/app/conversations?filter=mine" class="rounded-full px-3 py-1.5 font-medium {data.filter === 'mine' ? 'bg-[#e7fce9] text-[#008069]' : 'bg-slate-100 text-slate-500'}">Mine</a>
					<a href="/app/conversations?filter=unassigned" class="rounded-full px-3 py-1.5 font-medium {data.filter === 'unassigned' ? 'bg-[#e7fce9] text-[#008069]' : 'bg-slate-100 text-slate-500'}">Open</a>
				</div>
			</div>
			<div class="relative">
				<input bind:value={query} placeholder="Search or start a new chat" class="input !h-10 !min-h-10 !rounded-full border-0 bg-[#f0f2f5] py-1.5 pl-10 text-[14px] focus:bg-[#f0f2f5]" />
				<svg class="pointer-events-none absolute top-3 left-3.5 size-4 wa-text-muted" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
			</div>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
			{#each filtered as t (t.id)}
				<a
					href="/app/conversations/{t.id}"
					class="flex min-h-[72px] items-center gap-3 px-3 transition hover:bg-slate-50 {activeId === t.id ? 'bg-[#f0f2f5]' : ''}"
				>
					<div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#dfe5e7] text-[14px] font-bold wa-text-muted">{initials(t.name)}</div>
					<div class="min-w-0 flex-1 border-b border-slate-100 py-3">
						<div class="flex items-baseline justify-between gap-2">
							<span class="truncate text-[16px] font-medium wa-text">{t.name}</span>
							<span class="shrink-0 text-[11.5px] {t.unread > 0 ? 'font-medium text-[#00a884]' : 'wa-text-muted'}"><TimeAgo value={t.lastMessageAt} /></span>
						</div>
						<div class="flex items-center justify-between gap-2">
							<span class="truncate text-[13.5px] wa-text-muted">
								{#if t.assignedToMe}<span class="mr-1 text-[11.5px] font-semibold text-[#008069]">You:</span>{:else if t.assignedToName}<span class="mr-1 text-[11.5px] font-semibold wa-text-muted">{t.assignedToName}:</span>{:else}<span class="mr-1 text-[11.5px] font-semibold text-[#b58514]">Open:</span>{/if}
								{t.subject ?? t.channel.toLowerCase()}
							</span>
							{#if t.unread > 0}
								<span class="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1 text-[10.5px] leading-5 font-bold text-white">{t.unread}</span>
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
	<section class="{inThread ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-panel lg:border lg:border-slate-200 lg:shadow-panel">
		{@render children()}
	</section>
</div>
