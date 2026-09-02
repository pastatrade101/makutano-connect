<script lang="ts">
	// The marketplace at a glance. One question answered in words, then the loop, then
	// the operators behind it. Infrastructure only speaks when it is broken.
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data } = $props();

	const { waiting, demand, supply, loop, operators, infrastructure } = $derived(data);

	const broken = $derived(infrastructure.filter((i) => i.value > 0));

	/*
	 * The page in one sentence, before a single number.
	 *
	 * The owner's question is not "what are the numbers", it is "do I need to do
	 * something today". Two facts and a verdict, in the order they matter: the
	 * traveller first, then us, then the machines.
	 */
	const verdict = $derived.by(() => {
		const parts: { text: string; tone: 'bad' | 'warn' | 'good' }[] = [];
		if (waiting.unansweredStale > 0) {
			parts.push({
				tone: 'bad',
				text: `${waiting.unansweredStale} ${waiting.unansweredStale === 1 ? 'traveller has' : 'travellers have'} been waiting on an operator for more than ${waiting.staleAfterHours} hours${waiting.oldestDays >= 1 ? `, the oldest for ${waiting.oldestDays} days` : ''}.`
			});
		} else if (waiting.unanswered > 0) {
			parts.push({ tone: 'warn', text: `${waiting.unanswered} enquiries are waiting on an operator.` });
		} else {
			parts.push({ tone: 'good', text: 'Every enquiry has been answered.' });
		}

		const onUs = queues.reduce((sum, q) => sum + q.count, 0);
		parts.push(
			onUs > 0
				? { tone: 'warn', text: `${onUs} ${onUs === 1 ? 'thing is' : 'things are'} waiting on you.` }
				: { tone: 'good', text: 'Nothing is waiting on you.' }
		);
		if (broken.length) parts.push({ tone: 'bad', text: `${broken.length} system ${broken.length === 1 ? 'area needs' : 'areas need'} attention.` });
		return parts;
	});

	/*
	 * Every decision only the platform can make.
	 *
	 * APPROVED belongs here and was the one I missed: publish runs from APPROVED and
	 * is platform-only, so an approved listing is one nobody can see yet and only the
	 * owner can release. Leaving it out let this page say "nothing is waiting on you"
	 * with seventeen listings sitting invisible.
	 */
	const queues = $derived(
		[
			{ label: 'Approved, not yet published', count: waiting.toursReady, href: '/admin/marketplace/tours?tab=approved', since: waiting.toursReadySince },
			{ label: 'Listings awaiting review', count: waiting.toursAwaiting, href: '/admin/marketplace/tours?tab=pending', since: null },
			{ label: 'Reviews to moderate', count: waiting.reviewsPending, href: '/admin/reviews', since: null },
			{ label: 'Operators to verify', count: waiting.operatorsAwaiting, href: '/admin/marketplace/operators', since: null }
		].filter((q) => q.count > 0)
	);

	const TONE: Record<string, string> = {
		bad: 'text-danger',
		warn: 'text-warning',
		good: 'text-success'
	};

	/** Drop-off between two stages, shown only where the previous stage happened. */
	/*
	 * Share of the previous stage, and null when that cannot be said honestly.
	 *
	 * Above 100% means the two stages are not nested — a data problem, not a
	 * conversion rate — so it is withheld rather than printed as a triumph.
	 */
	const pct = (value: number, of: number) => {
		if (of <= 0) return null;
		const share = Math.round((value / of) * 100);
		return share > 100 ? null : share;
	};
	const stocked = $derived(pct(supply.destinationsStocked, supply.destinations));
</script>

<svelte:head><title>Overview · Makutano Admin</title></svelte:head>

<div class="space-y-4">
	<div>
		<h1 class="text-base font-semibold text-slate-900">Overview</h1>
		<p class="mt-0.5 text-xs text-slate-500">The marketplace, and whether anything needs you today.</p>
	</div>

	<!-- The verdict. Deliberately words, not tiles: the answer to "do I need to act"
	     should not require reading a grid and doing arithmetic. -->
	<section class="card p-4">
		<p class="space-x-1.5 text-[15px] leading-7">
			{#each verdict as part, i (i)}
				<span class="{TONE[part.tone]} font-medium">{part.text}</span>
			{/each}
		</p>
	</section>

	<!-- The owner's actual to-do list. Only non-empty queues appear; when they all
	     empty the block states the good news once, naming what was checked, rather
	     than leaving four zero tiles behind as furniture. -->
	<section class="card">
		<header class="card-header"><h2 class="card-title">Waiting on you</h2></header>
		{#if queues.length}
			<ul class="divide-y divide-slate-100">
				{#each queues as q (q.label)}
					<li class="flex items-center gap-3 px-4 py-2.5">
						<span class="w-10 shrink-0 text-lg font-semibold tabular-nums text-warning">{q.count}</span>
						<a href={q.href} class="flex-1 text-sm text-brand-600 hover:underline">{q.label}</a>
						{#if q.since}
							<span class="text-[11.5px] text-slate-400">oldest <TimeAgo value={q.since} /></span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="px-4 py-4 text-xs text-success">
				Nothing — no listings to publish or review, no reviews to moderate, no operator unverified.
			</p>
		{/if}
	</section>

	<!-- Demand, as a direction. -->
	<section class="grid gap-3 sm:grid-cols-3">
		<div class="card p-4">
			<p class="text-xs text-slate-500">Enquiries this week</p>
			<p class="mt-1 flex items-baseline gap-2">
				<span class="text-2xl font-semibold tabular-nums text-slate-900">{demand.last7}</span>
				{#if demand.changePct !== null}
					<span class="text-xs font-medium {demand.changePct >= 0 ? 'text-success' : 'text-danger'}">
						{demand.changePct >= 0 ? '+' : ''}{demand.changePct}%
					</span>
				{/if}
			</p>
			<p class="mt-0.5 text-[11.5px] text-slate-400">
				{demand.prev7} the week before{demand.changePct === null ? ' — no comparison yet' : ''}
			</p>
		</div>

		<div class="card p-4">
			<p class="text-xs text-slate-500">Live listings</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{supply.toursLive}</p>
			<p class="mt-0.5 text-[11.5px] text-slate-400">
				from {supply.customers} {supply.customers === 1 ? 'operator' : 'operators'}
			</p>
		</div>

		<div class="card p-4">
			<p class="text-xs text-slate-500">Your time to review</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
				{waiting.reviewHoursAvg === null ? '—' : `${waiting.reviewHoursAvg}h`}
			</p>
			<!-- The only number here nobody else can move. -->
			<p class="mt-0.5 text-[11.5px] text-slate-400">average from submitted to decided</p>
		</div>
	</section>

	<!-- The loop the business runs on, with the drop-off visible. -->
	<section class="card">
		<header class="card-header"><h2 class="card-title">The loop</h2></header>
		<div class="grid grid-cols-2 divide-slate-100 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
			{#each loop as stage, i (stage.stage)}
				{@const prev = i > 0 ? loop[i - 1].value : null}
				{@const share = prev !== null ? pct(stage.value, prev) : null}
				<div class="border-b border-slate-100 p-4 lg:border-b-0">
					<p class="text-xs text-slate-500">{stage.stage}</p>
					<p class="mt-1 text-xl font-semibold tabular-nums {stage.value === 0 && prev ? 'text-danger' : 'text-slate-900'}">
						{stage.value}
					</p>
					{#if share !== null}
						<!-- A zero with a denominator is the loudest thing on this page: it names
						     the exact step where the business stops working. -->
						<p class="mt-0.5 text-[11.5px] {stage.value === 0 && prev ? 'text-danger' : 'text-slate-400'}">
							{share}% of {loop[i - 1].stage.toLowerCase()}
						</p>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<!-- Operators, because a marketplace-wide total hides who is stuck. -->
	<section class="card overflow-hidden">
		<header class="card-header"><h2 class="card-title">Operators</h2></header>
		<div class="overflow-x-auto">
			<table class="min-w-[620px] divide-y divide-slate-100 sm:min-w-full">
				<thead class="bg-slate-50">
					<tr>
						<th class="table-head">Operator</th>
						<th class="table-head">Live</th>
						<th class="table-head">Awaiting you</th>
						<th class="table-head">Enquiries</th>
						<th class="table-head">Bookings</th>
						<th class="table-head">Where they are stuck</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each operators as o (o.id)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell">
								<a href="/admin/tenants/{o.id}" class="font-medium text-brand-600 hover:underline">{o.name}</a>
								{#if !o.verified}<span class="badge ml-1.5 bg-warning/10 text-warning">unverified</span>{/if}
							</td>
							<td class="table-cell tabular-nums text-slate-700">{o.live}</td>
							<td class="table-cell tabular-nums {o.awaiting ? 'font-medium text-warning' : 'text-slate-400'}">{o.awaiting || '—'}</td>
							<td class="table-cell tabular-nums text-slate-700">{o.enquiries || '—'}</td>
							<td class="table-cell tabular-nums text-slate-700">{o.bookings || '—'}</td>
							<td class="table-cell text-[11.5px]">
								<!-- Named, not inferred by the reader. Each of these is a different
								     job: help them list, help them get found, help them convert. -->
								{#if o.status === 'SUSPENDED'}
									<StatusBadge value={o.status} />
								{:else if o.live === 0 && o.awaiting === 0}
									<span class="text-danger">Nothing published yet</span>
								{:else if o.live === 0}
									<span class="text-warning">Waiting on your review</span>
								{:else if o.enquiries === 0}
									<span class="text-warning">Published, no enquiries yet</span>
								{:else if o.bookings === 0}
									<span class="text-warning">Enquiries, no bookings yet</span>
								{:else}
									<span class="text-success">Converting</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Supply gap: pages the marketplace is selling and cannot fulfil. -->
	{#if stocked !== null && supply.destinationsStocked < supply.destinations}
		<section class="card p-4">
			<p class="text-xs text-slate-500">Destination pages with something to sell</p>
			<p class="mt-1 flex items-baseline gap-2">
				<span class="text-xl font-semibold tabular-nums text-slate-900">
					{supply.destinationsStocked} <span class="text-sm font-normal text-slate-400">of {supply.destinations}</span>
				</span>
				<span class="text-xs font-medium {stocked < 50 ? 'text-warning' : 'text-slate-400'}">{stocked}%</span>
			</p>
			<p class="mt-1 text-[11.5px] text-slate-400">
				The rest are published pages with no live listing behind them — a traveller who lands there
				finds nothing to book.
			</p>
		</section>
	{/if}

	<!-- Infrastructure. One line when healthy; the whole story only when it is not. -->
	<section class="card p-3">
		{#if broken.length === 0}
			<p class="text-xs text-success">
				<span class="font-medium">Systems healthy</span>
				<span class="text-slate-400">— no dead jobs, webhooks, failed payments or WhatsApp connections needing re-auth.</span>
			</p>
		{:else}
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
				<span class="font-medium text-danger">Needs attention:</span>
				{#each broken as item (item.label)}
					<a href={item.href} class="text-danger hover:underline">{item.label} <span class="tabular-nums">{item.value}</span></a>
				{/each}
			</div>
		{/if}
	</section>
</div>
