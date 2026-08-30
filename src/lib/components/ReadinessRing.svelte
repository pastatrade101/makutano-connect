<script lang="ts">
	// Readiness as a ring rather than a bar, because on a card it has to read at a
	// glance from across a desk. Same rule as the bar it replaces: the colour is
	// driven by whether anything CRITICAL is outstanding, never by the percentage —
	// 90% with no driver is blocked, and painting that amber would be the ring
	// lying about the one thing it exists to say.
	type Check = { key: string; label: string; done: boolean; critical: boolean };
	let {
		readiness,
		status,
		daysToDeparture = null,
		size = 52
	}: {
		readiness: { percent: number; missing: Check[]; canBeReady: boolean } | null;
		status?: string;
		/** Blocked far out is normal; blocked and leaving this week is not. */
		daysToDeparture?: number | null;
		size?: number;
	} = $props();

	const R = 20;
	const CIRCUMFERENCE = 2 * Math.PI * R;

	const percent = $derived(readiness?.percent ?? 0);
	const blocked = $derived(Boolean(readiness && !readiness.canBeReady));
	const done = $derived(status === 'COMPLETED');

	// Every trip in setup is blocked, so painting them all red makes red mean
	// nothing. Red is reserved for blocked AND leaving within the week — the ones
	// somebody has to do something about today.
	const soon = $derived(daysToDeparture !== null && daysToDeparture <= 7);
	const tone = $derived(
		done ? 'done' : blocked ? (soon ? 'urgent' : 'pending') : percent === 100 ? 'clear' : 'progress'
	);
	const stroke = $derived(
		{
			done: 'var(--color-slate-400)',
			urgent: 'var(--color-danger)',
			pending: '#f59e0b',
			clear: 'var(--color-success)',
			progress: 'var(--color-brand-600)'
		}[tone]
	);
	const text = $derived(
		{
			done: 'text-slate-400',
			urgent: 'text-danger',
			pending: 'text-amber-600',
			clear: 'text-success',
			progress: 'text-slate-700'
		}[tone]
	);
</script>

<div
	class="relative shrink-0"
	style="width: {size}px; height: {size}px"
	role="img"
	aria-label="Trip readiness {percent}%{blocked ? ', blocked' : ''}"
>
	<svg viewBox="0 0 48 48" class="h-full w-full -rotate-90">
		<circle cx="24" cy="24" r={R} fill="none" stroke="var(--color-slate-200)" stroke-width="4" />
		<circle
			cx="24"
			cy="24"
			r={R}
			fill="none"
			stroke={stroke}
			stroke-width="4"
			stroke-linecap="round"
			stroke-dasharray={CIRCUMFERENCE}
			stroke-dashoffset={CIRCUMFERENCE * (1 - percent / 100)}
			style="transition: stroke-dashoffset 400ms ease-out"
		/>
	</svg>
	<span class="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums {text}">
		{#if readiness}{percent}{:else}—{/if}
	</span>
</div>
