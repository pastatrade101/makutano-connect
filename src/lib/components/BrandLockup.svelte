<script lang="ts">
	let {
		href = '/',
		size = 'md',
		showName = true,
		inverse = false
	}: {
		href?: string;
		size?: 'sm' | 'md' | 'lg';
		showName?: boolean;
		inverse?: boolean;
	} = $props();

	const markSize = $derived(size === 'lg' ? 'size-11 text-base' : size === 'sm' ? 'size-8 text-xs' : 'size-9 text-sm');
	const nameSize = $derived(size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-[14px]' : 'text-[15px]');
</script>

<a href={href} class="inline-flex items-center gap-2.5" aria-label="Makutano Connect home">
	<span class="flex {markSize} shrink-0 items-center justify-center rounded-lg bg-brand-500 font-bold text-white shadow-[0_8px_20px_rgba(28,132,238,0.22)]">M</span>
	{#if showName}
		<span class="{nameSize} font-bold tracking-tight {inverse ? 'text-white' : 'text-slate-900'}">
			Makutano <span class={inverse ? 'text-blue-200' : 'text-brand-500'}>Connect</span>
		</span>
	{/if}
</a>
