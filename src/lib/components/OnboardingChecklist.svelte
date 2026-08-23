<!-- Getting-started card. Every tick reflects real data, so it cannot be gamed. -->
<script lang="ts">
	import { enhance } from '$app/forms';

	type Item = { key: string; label: string; description: string; href: string; done: boolean };
	let {
		items,
		completed,
		total,
		welcome = false
	}: { items: Item[]; completed: number; total: number; welcome?: boolean } = $props();

	const percent = $derived(total ? Math.round((completed / total) * 100) : 0);
	let open = $state(true);
</script>

<div class="card mb-4 overflow-hidden">
	<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
		<div class="min-w-0">
			<h2 class="text-sm font-semibold text-slate-700">
				{welcome ? 'Welcome to Makutano Connect' : 'Finish setting up'}
			</h2>
			<p class="mt-0.5 text-xs text-slate-500">
				{completed} of {total} done — you can use everything already, this just makes it work harder.
			</p>
		</div>
		<div class="flex items-center gap-3">
			<div class="hidden h-1.5 w-28 overflow-hidden rounded-full bg-slate-200 sm:block">
				<div class="h-full rounded-full bg-brand-500 transition-all" style="width:{percent}%"></div>
			</div>
			<button type="button" class="btn-secondary px-2 py-1 text-xs" onclick={() => (open = !open)}>
				{open ? 'Hide' : 'Show'}
			</button>
			<form method="POST" action="?/dismissOnboarding" use:enhance>
				<button type="submit" class="text-xs text-slate-400 hover:text-slate-600" title="Dismiss this checklist">✕</button>
			</form>
		</div>
	</div>

	{#if open}
		<ul class="divide-y divide-slate-100">
			{#each items as item (item.key)}
				<li class="flex items-start gap-3 px-4 py-2.5">
					<span
						class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold {item.done
							? 'bg-success text-white'
							: 'border border-slate-300 text-transparent'}">✓</span
					>
					<div class="min-w-0 flex-1">
						<p class="text-sm {item.done ? 'text-slate-400 line-through' : 'font-medium text-slate-700'}">{item.label}</p>
						{#if !item.done}
							<p class="mt-0.5 text-xs text-slate-500">{item.description}</p>
						{/if}
					</div>
					{#if !item.done}
						<a href={item.href} class="btn-secondary shrink-0 px-2.5 py-1 text-xs">Set up</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
