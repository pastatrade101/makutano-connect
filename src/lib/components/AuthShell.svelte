<!-- Shared frame for every public, signed-out page: signup, verification, reset. -->
<script lang="ts">
	import BrandLockup from './BrandLockup.svelte';

	let {
		title,
		subtitle = '',
		width = 'sm',
		children,
		footer
	}: {
		title: string;
		subtitle?: string;
		width?: 'sm' | 'md' | 'lg' | 'xl';
		children: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	} = $props();

	const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
</script>

<div class="auth-surface relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f6f8fc] px-4 py-8 sm:px-6 sm:py-12">
	<div class="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true"></div>
	<div class="relative w-full {widths[width]}">
		<div class="mb-8 text-center">
			<BrandLockup size="lg" />
			<h1 class="mt-7 text-2xl font-bold tracking-[-0.025em] text-slate-900 sm:text-[28px]">{title}</h1>
			{#if subtitle}<p class="mx-auto mt-2 max-w-xl text-[13.5px] leading-6 text-slate-500">{subtitle}</p>{/if}
		</div>

		{@render children()}

		{#if footer}
			<div class="mt-6 text-center text-xs text-slate-500">{@render footer()}</div>
		{/if}
	</div>
</div>

<style>
	.auth-surface > :global(div:first-child) {
		background-image:
			radial-gradient(circle at 18% 10%, rgb(28 132 238 / 0.08), transparent 27rem),
			radial-gradient(circle at 85% 85%, rgb(78 202 194 / 0.07), transparent 24rem),
			linear-gradient(rgb(50 58 70 / 0.035) 1px, transparent 1px),
			linear-gradient(90deg, rgb(50 58 70 / 0.035) 1px, transparent 1px);
		background-size: auto, auto, 32px 32px, 32px 32px;
		mask-image: linear-gradient(to bottom, black, rgb(0 0 0 / 0.45) 70%, transparent);
	}
</style>
