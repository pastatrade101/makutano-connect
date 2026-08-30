<script lang="ts">
	// One trip, as an operations person reads it: where it is going, when it leaves,
	// and — the only question that matters before departure — what is still stopping
	// it. A table row buried that last part in a progress cell; here it is the line
	// with the most contrast on the card.
	import ReadinessRing from '$components/ReadinessRing.svelte';
	import { blockerLabel } from '$lib/labels';

	type Check = { key: string; label: string; done: boolean; critical: boolean };
	let {
		row,
		timezone
	}: {
		row: {
			trip: {
				id: string;
				tripReference: string;
				title: string;
				status: string;
				startDate: string | Date | null;
				endDate: string | Date | null;
				adults: number;
				children: number;
				driver: string | null;
				vehicle: string | null;
			};
			readiness: { percent: number; missing: Check[]; canBeReady: boolean } | null;
			customerName?: string | null;
			daysToDeparture: number | null;
		};
		timezone?: string;
	} = $props();

	const guests = $derived(row.trip.adults + row.trip.children);
	const blocking = $derived(row.readiness?.missing.filter((c) => c.critical) ?? []);

	const fmt = (v: string | Date | null, opts: Intl.DateTimeFormatOptions) =>
		v ? new Date(v).toLocaleDateString('en-GB', { timeZone: timezone, ...opts }) : null;

	const dates = $derived.by(() => {
		const from = row.trip.startDate;
		if (!from) return 'No dates yet';
		const to = row.trip.endDate;
		const f = fmt(from, { day: 'numeric', month: 'short' });
		return to ? `${fmt(from, { day: 'numeric' })}–${fmt(to, { day: 'numeric', month: 'short' })}` : f;
	});

	// "in 3 days" beats a date an operations person has to subtract from today.
	const countdown = $derived.by(() => {
		const n = row.daysToDeparture;
		if (n === null) return null;
		if (n < 0) return 'under way';
		if (n === 0) return 'today';
		if (n === 1) return 'tomorrow';
		return `in ${n} days`;
	});

	// Urgency is the intersection of soon and not-ready — either alone is fine.
	const urgent = $derived(
		row.readiness !== null &&
			!row.readiness.canBeReady &&
			row.daysToDeparture !== null &&
			row.daysToDeparture >= 0 &&
			row.daysToDeparture <= 7
	);
</script>

<a
	href="/app/trips/{row.trip.id}"
	class="group block rounded-xl border bg-white p-4 transition hover:border-brand-300 hover:shadow-sm
		{urgent ? 'border-danger/40 ring-1 ring-danger/10' : 'border-slate-200'}"
>
	<div class="flex items-start gap-4">
		<ReadinessRing readiness={row.readiness} status={row.trip.status} daysToDeparture={row.daysToDeparture} />

		<div class="min-w-0 flex-1">
			<div class="flex items-baseline gap-2">
				<h3 class="truncate font-semibold text-slate-900 group-hover:text-brand-700">{row.trip.title}</h3>
				{#if countdown}
					<span class="shrink-0 text-xs font-medium {urgent ? 'text-danger' : 'text-slate-400'}">· {countdown}</span>
				{/if}
				<span class="flex-1"></span>
				<!-- Only states that carry information. PREPARING is the default and a
				     badge saying so would be noise on every card. -->
				{#if row.trip.status === 'READY' && blocking.length}
					<!-- Marked ready, and then something that made it ready went away. Saying
					     "Ready" over a list of blockers would be the card contradicting
					     itself; the trip needs looking at again. -->
					<span class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
						No longer ready
					</span>
				{:else if row.trip.status === 'READY'}
					<span class="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">Ready</span>
				{:else if row.trip.status === 'IN_PROGRESS'}
					<span class="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">Under way</span>
				{/if}
			</div>

			<p class="mt-0.5 truncate text-xs text-slate-400">
				{row.trip.tripReference}{#if row.customerName} · {row.customerName}{/if}
			</p>

			<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
				<span>{dates}</span>
				<span>{guests} guest{guests === 1 ? '' : 's'}</span>
				{#if row.trip.driver}<span class="truncate">{row.trip.driver}</span>{/if}
			</div>

			<!-- The line the card exists for. Naming what is missing is the difference
			     between a status and an instruction. -->
			{#if blocking.length}
				<p class="mt-2 text-sm font-medium text-danger">
					Still needs {blocking.map(blockerLabel).join(', ')}
				</p>
			{:else if row.readiness && row.trip.status === 'PREPARING'}
				<p class="mt-2 text-sm font-medium text-success">Ready to be marked ready</p>
			{:else if row.trip.status === 'READY'}
				<p class="mt-2 text-sm font-medium text-success">Ready to go</p>
			{/if}
		</div>
	</div>
</a>
