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

	const markSize = $derived(size === 'lg' ? 'size-11' : size === 'sm' ? 'size-8' : 'size-9');
	const nameSize = $derived(size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-[15.5px]' : 'text-[16.5px]');
</script>

<a href={href} class="inline-flex items-center gap-2.5" aria-label="Makutano Connect home">
	<img src="/2.png" alt="" class="{markSize} shrink-0 object-contain drop-shadow-[0_6px_14px_rgba(180,83,42,0.25)]" />
	{#if showName}
		<span class="{nameSize} font-bold tracking-tight {inverse ? 'text-white' : 'text-slate-900'}">
			Makutano <span class={inverse ? 'text-brand-200' : 'text-brand-500'}>Connect</span>
		</span>
	{/if}
</a>
