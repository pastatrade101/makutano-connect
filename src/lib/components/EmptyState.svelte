<script lang="ts">
	let { title, description = null, action = null }: { title: string; description?: string | null; action?: { href: string; label: string } | null } = $props();
</script>

<div class="px-3 py-10 text-center">
	<p class="text-sm font-medium text-slate-700">{title}</p>
	{#if description}<p class="mx-auto mt-1 max-w-md text-xs text-slate-500">{description}</p>{/if}
	{#if action}<a href={action.href} class="btn-primary mt-3">{action.label}</a>{/if}
</div>
