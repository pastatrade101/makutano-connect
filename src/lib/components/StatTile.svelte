<script lang="ts">
	// Dense KPI tile (§22) — small, uniform, and scannable in a row of six.
	let {
		label,
		value,
		hint = null,
		tone = 'default',
		href = null
	}: {
		label: string;
		value: string | number;
		hint?: string | null;
		tone?: 'default' | 'warn' | 'good' | 'bad';
		href?: string | null;
	} = $props();

	const TONES = {
		default: 'text-slate-900',
		warn: 'text-amber-600',
		good: 'text-emerald-600',
		bad: 'text-red-600'
	} as const;
</script>

{#snippet body()}
	<div class="px-3 py-2.5">
		<div class="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
		<div class="mt-0.5 text-xl font-semibold tabular-nums {TONES[tone]}">{value}</div>
		{#if hint}<div class="mt-0.5 text-[11px] text-slate-400">{hint}</div>{/if}
	</div>
{/snippet}

{#if href}
	<a {href} class="card block transition hover:border-brand-500 hover:shadow-sm">{@render body()}</a>
{:else}
	<div class="card">{@render body()}</div>
{/if}
