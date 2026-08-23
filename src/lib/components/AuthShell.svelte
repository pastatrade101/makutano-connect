<!-- Shared frame for every public, signed-out page: signup, verification, reset. -->
<script lang="ts">
	let {
		title,
		subtitle = '',
		width = 'sm',
		children,
		footer
	}: {
		title: string;
		subtitle?: string;
		width?: 'sm' | 'md' | 'lg';
		children: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	} = $props();

	const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-10">
	<div class="w-full {widths[width]}">
		<div class="mb-6 text-center">
			<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-panel bg-brand-500 text-lg font-bold text-white shadow-panel">M</div>
			<h1 class="text-xl font-bold tracking-tight text-slate-800">{title}</h1>
			{#if subtitle}<p class="mt-1 text-xs text-slate-500">{subtitle}</p>{/if}
		</div>

		{@render children()}

		{#if footer}
			<div class="mt-5 text-center text-[11px] text-slate-400">{@render footer()}</div>
		{/if}
	</div>
</div>
