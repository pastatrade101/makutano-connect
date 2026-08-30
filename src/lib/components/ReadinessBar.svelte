<script lang="ts">
	// How close a trip is to being able to leave.
	//
	// The colour is driven by whether anything CRITICAL is outstanding, not by the
	// percentage. A trip at 90% with no driver cannot depart, and showing that in
	// reassuring green would be the bar lying about the only thing it exists to say.
	type Check = { key: string; label: string; done: boolean; critical: boolean };
	let {
		readiness,
		showLabel = true
	}: { readiness: { percent: number; missing: Check[] }; showLabel?: boolean } = $props();

	const blocked = $derived(readiness.missing.some((c) => c.critical));
	const tone = $derived(
		blocked ? 'bg-danger' : readiness.percent === 100 ? 'bg-success' : 'bg-amber-500'
	);
	const text = $derived(
		blocked ? 'text-danger' : readiness.percent === 100 ? 'text-success' : 'text-slate-600'
	);
</script>

<div class="flex items-center gap-2">
	<div
		class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200"
		role="progressbar"
		aria-valuenow={readiness.percent}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-label="Trip readiness"
	>
		<div class="h-full rounded-full {tone} transition-[width] duration-300" style="width: {readiness.percent}%"></div>
	</div>
	{#if showLabel}
		<span class="text-xs font-semibold tabular-nums {text}">{readiness.percent}%</span>
	{/if}
</div>
