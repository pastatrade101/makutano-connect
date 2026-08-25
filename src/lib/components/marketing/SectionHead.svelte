<script lang="ts">
	// The theme's signature section opener: a brand icon chip, a dashed rule, then a
	// pill label — followed by the heading and a muted line. Reused by every section
	// so the page has one rhythm instead of six.
	let {
		label,
		title,
		subtitle = null,
		align = 'center',
		icon = 'M4 10h12M10 4v12'
	}: {
		label: string;
		title: string;
		subtitle?: string | null;
		align?: 'center' | 'left';
		icon?: string;
	} = $props();
</script>

<div class={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
	<p class="flex items-center gap-2 {align === 'center' ? 'justify-center' : ''}">
		<span class="flex size-[30px] items-center justify-center rounded-md bg-brand-500 text-white">
			<svg class="size-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d={icon} /></svg>
		</span>
		<span class="h-px w-6 border-t border-dashed border-brand-400"></span>
		<span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[13px] font-semibold text-brand-600">{label}</span>
	</p>
	<h2 class="mt-4 text-[29px] leading-[1.35] font-bold tracking-[-0.02em] text-slate-900 sm:text-[33px]">{title}</h2>
	{#if subtitle}
		<p class="mt-3 text-[16px] leading-7 text-slate-500">{subtitle}</p>
	{/if}
</div>
