<script lang="ts">
	// Reback stat card: muted uppercase title, heavy value, icon bubble in a soft
	// brand tint. Dense enough to sit six-across on a dashboard row.
	let {
		label,
		value,
		hint = null,
		tone = 'default',
		href = null,
		icon = null
	}: {
		label: string;
		value: string | number;
		hint?: string | null;
		tone?: 'default' | 'warn' | 'good' | 'bad';
		href?: string | null;
		icon?: string | null;
	} = $props();

	const TONES = {
		default: 'text-slate-800',
		warn: 'text-warning',
		good: 'text-success',
		bad: 'text-danger'
	} as const;

	const BUBBLES = {
		default: 'bg-brand-50 text-brand-500',
		warn: 'bg-warning/10 text-warning',
		good: 'bg-success/10 text-success',
		bad: 'bg-danger/10 text-danger'
	} as const;
</script>

{#snippet body()}
	<div class="flex items-center justify-between px-4 py-3">
		<div class="min-w-0">
			<div class="truncate text-[12.5px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
			<div class="mt-1 text-[22px] leading-7 font-bold tabular-nums {TONES[tone]}">{value}</div>
			{#if hint}<div class="mt-0.5 truncate text-[12.5px] text-slate-400">{hint}</div>{/if}
		</div>
		{#if icon}
			<div class="flex size-10 shrink-0 items-center justify-center rounded-panel {BUBBLES[tone]}">
				<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={icon} /></svg>
			</div>
		{/if}
	</div>
{/snippet}

{#if href}
	<a {href} class="card block transition hover:-translate-y-px hover:shadow-md">{@render body()}</a>
{:else}
	<div class="card">{@render body()}</div>
{/if}
