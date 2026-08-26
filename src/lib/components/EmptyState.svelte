<script lang="ts">
	// An empty list is the best teaching moment Connect gets: say how this kind of work
	// normally arrives, then offer the one action that starts it. A second, quieter
	// action covers the other honest route in (usually "open the inbox").
	type Action = { href: string; label: string };
	let {
		title,
		description = null,
		action = null,
		secondary = null
	}: { title: string; description?: string | null; action?: Action | null; secondary?: Action | null } = $props();
</script>

<div class="px-3 py-10 text-center">
	<p class="text-sm font-medium text-slate-700">{title}</p>
	{#if description}<p class="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">{description}</p>{/if}
	{#if action || secondary}
		<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
			{#if action}<a href={action.href} class="btn-primary">{action.label}</a>{/if}
			{#if secondary}<a href={secondary.href} class="btn-secondary">{secondary.label}</a>{/if}
		</div>
	{/if}
</div>
