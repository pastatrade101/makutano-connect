<script lang="ts">
	import Chart from '$components/Chart.svelte';
	import { chartPalette, theme } from '$lib/stores/theme.svelte';

	let { data } = $props();
	const p = $derived(data.performance);
	const current = $derived(p.current);
	const previous = $derived(p.previous);
	const pal = $derived(chartPalette(theme.dark));

	const ranges = [
		{ key: '7d', label: '7 days' },
		{ key: '30d', label: '30 days' },
		{ key: '90d', label: '90 days' },
		{ key: 'all', label: 'All time' }
	];

	const number = new Intl.NumberFormat('en');

	/**
	 * Money is never totalled across currencies — there is no rate table behind
	 * this page — so each bucket can carry more than one figure and every one of
	 * them is rendered. Whole units only: a pipeline is read for its size.
	 */
	type MoneyTotal = { currency: string; amount: number };
	const money = (totals: MoneyTotal[]) =>
		totals.map((total) => {
			try {
				return new Intl.NumberFormat('en', {
					style: 'currency',
					currency: total.currency,
					maximumFractionDigits: 0
				}).format(total.amount);
			} catch {
				return `${total.currency} ${Math.round(total.amount).toLocaleString('en')}`;
			}
		});
	const moneyLine = (totals: MoneyTotal[]) => (totals.length ? money(totals).join(' · ') : null);
	/** In a dense row only the largest fits; the rest stay reachable on hover. */
	const moneyShort = (totals: MoneyTotal[]) => {
		const parts = money(totals);
		if (!parts.length) return null;
		return parts.length === 1 ? parts[0] : `${parts[0]} +${parts.length - 1}`;
	};
	const formatRatio = (value: number | null) => (value === null ? '—' : value.toFixed(1));
	const day = $derived(new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: data.timezone }));
	const formatRate = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}%`);
	const formatResponse = (hours: number | null) => {
		if (hours === null) return '—';
		if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
		if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
		return `${(hours / 24).toFixed(1)}d`;
	};
	const delta = (value: number | null, old: number | null, lowerIsBetter = false) => {
		if (value === null || old === null || old === 0) return null;
		const amount = Math.round(((value - old) / old) * 100);
		if (!Number.isFinite(amount) || amount === 0) return { text: 'No change', good: null };
		return {
			text: `${amount > 0 ? '+' : ''}${amount}% vs prior period`,
			good: lowerIsBetter ? amount < 0 : amount > 0
		};
	};

	const cards = $derived([
		{
			label: 'Tour views',
			value: number.format(current.tourViews),
			hint: 'Tour detail pages',
			change: delta(current.tourViews, previous?.tourViews ?? null),
			icon: 'M3 17V8l7-5 7 5v9H3Zm4-1h6v-5H7v5Z'
		},
		{
			label: 'Profile views',
			value: number.format(current.profileViews),
			hint: 'Operator storefront',
			change: delta(current.profileViews, previous?.profileViews ?? null),
			icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0H4Z'
		},
		{
			label: 'Enquiries received',
			value: number.format(current.enquiries),
			hint: 'Created in this period',
			change: delta(current.enquiries, previous?.enquiries ?? null),
			icon: 'M3 4h14v10H7l-4 3V4Z'
		},
		{
			label: 'Quote rate',
			value: formatRate(current.quoteRate),
			hint: `${number.format(current.quoted)} of ${number.format(current.enquiries)} enquiries`,
			change: delta(current.quoteRate, previous?.quoteRate ?? null),
			icon: 'M5 3h7l3 3v11H5V3Zm7 0v3h3M7 10h6M7 13h4'
		},
		{
			label: 'Booking conversion',
			value: formatRate(current.bookingConversion),
			hint: `${number.format(current.booked)} enquiries became bookings`,
			change: delta(current.bookingConversion, previous?.bookingConversion ?? null),
			icon: 'M3 5h14v12H3V5Zm3-2v4m8-4v4M6 10h8'
		},
		{
			label: 'Reviews',
			value: current.reviews.average === null ? '—' : `${current.reviews.average.toFixed(1)} ★`,
			hint: `${number.format(current.reviews.count)} published · ${number.format(current.reviews.new)} new`,
			change: null,
			icon: 'm10 2.6 2.3 4.7 5.2.7-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.5 8l5.2-.7L10 2.6Z'
		},
		{
			label: 'Response time',
			value: formatResponse(current.medianResponseHours),
			hint: `Median · ${number.format(current.unanswered)} unanswered`,
			change: delta(current.medianResponseHours, previous?.medianResponseHours ?? null, true),
			icon: 'M10 3a7 7 0 1 0 7 7M10 6v4l3 2'
		}
	]);

	const chartOptions = $derived({
		chart: { type: 'area' as const, height: 290, toolbar: { show: false }, fontFamily: 'inherit', zoom: { enabled: false } },
		series: [
			{ name: 'Tour views', data: p.trend.map((row) => row.tourViews) },
			{ name: 'Profile views', data: p.trend.map((row) => row.profileViews) },
			{ name: 'Enquiries', data: p.trend.map((row) => row.enquiries) }
		],
		xaxis: {
			categories: p.trend.map((row) => day.format(new Date(`${row.day}T12:00:00Z`))),
			labels: { style: { colors: pal.label, fontSize: '11px' }, rotate: 0, hideOverlappingLabels: true },
			axisBorder: { show: false },
			axisTicks: { show: false },
			tickAmount: 7
		},
		yaxis: { min: 0, forceNiceScale: true, labels: { style: { colors: pal.label, fontSize: '11px' } } },
		colors: ['#b4532a', '#47725b', '#4878a8'],
		stroke: { curve: 'smooth' as const, width: [2.5, 2.5, 2] },
		fill: { type: 'gradient', gradient: { opacityFrom: 0.22, opacityTo: 0.015 } },
		dataLabels: { enabled: false },
		grid: { borderColor: pal.grid, strokeDashArray: 4 },
		legend: { position: 'top' as const, horizontalAlign: 'left' as const, labels: { colors: pal.legend } },
		tooltip: { theme: pal.tooltip }
	});

	const funnel = $derived([
		{ label: 'Detail views', value: current.tourViews + current.profileViews },
		{ label: 'Enquiries', value: current.enquiries },
		{ label: 'Quoted', value: current.quoted },
		{ label: 'Booked', value: current.booked }
	]);
	const maxFunnel = $derived(Math.max(...funnel.map((step) => step.value), 1));

	/**
	 * The three ways an enquiry can stand. They partition the cohort, so the counts
	 * add back to "Enquiries" above — and each carries what it is worth, because
	 * "we lost five" and "we lost $48,000" are different sentences.
	 */
	const outcomes = $derived([
		{
			key: 'stillOpen',
			label: 'Still open',
			hint: 'Awaiting a decision — this is the follow-up list',
			bucket: current.funnel.stillOpen,
			tone: 'text-warning',
			bar: 'bg-warning'
		},
		{
			key: 'notBooked',
			label: 'Not booked',
			hint: 'Declined, cancelled, or the offer lapsed',
			bucket: current.funnel.notBooked,
			tone: 'text-slate-600',
			bar: 'bg-slate-300'
		},
		{
			key: 'booked',
			label: 'Booked',
			hint: 'Won',
			bucket: current.funnel.booked,
			tone: 'text-success',
			bar: 'bg-success'
		}
	]);
	const decided = $derived(current.funnel.notBooked.count + current.funnel.booked.count);
</script>

<svelte:head><title>Marketplace performance</title></svelte:head>

<div class="space-y-4">
	<header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-[11px] font-bold tracking-[0.16em] text-brand-600 uppercase">Marketplace</p>
			<h1 class="mt-0.5 text-xl font-bold tracking-tight text-slate-900">Performance</h1>
			<p class="mt-1 max-w-2xl text-[13px] text-slate-500">
				How travellers discover your storefront, enquire, and turn into bookings.
			</p>
		</div>
		<nav aria-label="Date range" class="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
			{#each ranges as range (range.key)}
				<a
					href={`?range=${range.key}`}
					aria-current={p.range.key === range.key ? 'page' : undefined}
					class="rounded-md px-3 py-1.5 text-xs font-semibold transition {p.range.key === range.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}"
				>{range.label}</a>
			{/each}
		</nav>
	</header>

	{#if !current.trackingSince}
		<div class="rounded-xl border border-info/20 bg-info/5 px-4 py-3 text-[13px] text-slate-600">
			<strong class="text-slate-800">View tracking starts after this release.</strong>
			Enquiries, quotes, bookings and reviews still use your existing records.
		</div>
	{/if}

	<section aria-label="Marketplace key metrics" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
		{#each cards as card (card.label)}
			<article class="card min-h-36 p-4">
				<div class="flex items-start justify-between gap-3">
					<div>
						<p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">{card.label}</p>
						<p class="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{card.value}</p>
					</div>
					<span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
						<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={card.icon} /></svg>
					</span>
				</div>
				<p class="mt-3 text-[12px] text-slate-500">{card.hint}</p>
				{#if card.change}
					<p class="mt-1 text-[11px] font-semibold {card.change.good === true ? 'text-success' : card.change.good === false ? 'text-danger' : 'text-slate-400'}">
						{card.change.text}
					</p>
				{/if}
			</article>
		{/each}
	</section>

	<div class="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
		<section class="card overflow-hidden">
			<header class="border-b border-slate-200 px-4 py-3">
				<h2 class="text-sm font-semibold text-slate-900">Marketplace activity</h2>
				<p class="mt-0.5 text-[12px] text-slate-500">
					{p.range.chartIsLimited ? 'Daily activity for the most recent 90 days; headline totals are all-time.' : p.range.label}
				</p>
			</header>
			<div class="px-2 pt-2 sm:px-4"><Chart options={chartOptions} /></div>
		</section>

		<section class="card p-4">
			<h2 class="text-sm font-semibold text-slate-900">Conversion path</h2>
			<p class="mt-0.5 text-[12px] text-slate-500">Enquiries are grouped by when they arrived.</p>
			<div class="mt-5 space-y-4">
				{#each funnel as step, i (step.label)}
					<div>
						<div class="mb-1.5 flex items-baseline justify-between gap-3">
							<span class="text-[12.5px] font-medium text-slate-600">{i + 1}. {step.label}</span>
							<strong class="text-sm text-slate-900 tabular-nums">{number.format(step.value)}</strong>
						</div>
						<div class="h-2 overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full bg-brand-500 transition-all" style={`width:${Math.max(step.value ? 5 : 0, (step.value / maxFunnel) * 100)}%`}></div>
						</div>
					</div>
				{/each}
			</div>
			<div class="mt-6 border-t border-slate-100 pt-5">
				<div class="flex items-baseline justify-between gap-3">
					<h3 class="text-[12.5px] font-semibold text-slate-800">Where they stand</h3>
					<span class="text-[11px] text-slate-400">{number.format(current.enquiries)} enquiries</span>
				</div>
				<dl class="mt-3 space-y-3">
					{#each outcomes as outcome (outcome.key)}
						{@const line = moneyLine(outcome.bucket.value)}
						<div>
							<div class="flex items-baseline justify-between gap-3">
								<dt class="text-[12.5px] text-slate-600" title={outcome.hint}>{outcome.label}</dt>
								<dd class="text-right">
									<strong class="text-sm tabular-nums {outcome.tone}">{number.format(outcome.bucket.count)}</strong>
									{#if line}<span class="ml-1.5 text-[11.5px] text-slate-400 tabular-nums">{line}</span>{/if}
								</dd>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
								<div
									class="h-full rounded-full {outcome.bar} transition-all"
									style={`width:${current.enquiries ? (outcome.bucket.count / current.enquiries) * 100 : 0}%`}
								></div>
							</div>
						</div>
					{/each}
				</dl>
				<div class="mt-4 flex items-baseline justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
					<span class="text-[12px] font-medium text-slate-600">Enquiries per booking</span>
					<strong class="text-sm text-slate-900 tabular-nums">{formatRatio(current.funnel.requestsPerBooking)}</strong>
				</div>
				<p class="mt-1.5 text-[11px] leading-4 text-slate-400">
					Counts the {number.format(decided)} enquir{decided === 1 ? 'y' : 'ies'} that reached an outcome, so a
					fresh batch of leads does not make the ratio look worse.
				</p>
			</div>

			{#if current.enquiries > 0 && current.enquiries < 5}
				<p class="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
					Rates can move sharply with fewer than five enquiries. Read the counts alongside the percentages.
				</p>
			{/if}
		</section>
	</div>

	<section class="card overflow-hidden">
		<header class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">Tour performance</h2>
				<p class="mt-0.5 text-[12px] text-slate-500">Every listing, ordered by views and enquiries.</p>
			</div>
			<a href="/app/tours" class="text-xs font-semibold text-brand-600 hover:underline">Manage tours</a>
		</header>

		{#if p.tours.length}
			<div class="divide-y divide-slate-100 md:hidden">
				{#each p.tours as tour (tour.id)}
					<a href={`/app/tours/${tour.id}`} class="block p-4 transition hover:bg-slate-50">
						<div class="flex gap-3">
							{#if tour.heroUrl}
								<img src={tour.heroUrl} alt="" class="size-16 shrink-0 rounded-lg object-cover" loading="lazy" />
							{:else}
								<div class="flex size-16 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-300">
									<svg class="size-7" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16 7.5 10l3 3 2-2 4.5 5H3ZM5 5h10v11H5V5Z" /></svg>
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<div class="flex items-start justify-between gap-2">
									<h3 class="truncate text-sm font-semibold text-slate-900">{tour.title}</h3>
									<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{tour.status.replaceAll('_', ' ')}</span>
								</div>
								<div class="mt-3 grid grid-cols-4 gap-2 text-[11px] text-slate-500">
									<span><strong class="block text-sm text-slate-800">{number.format(tour.views)}</strong>Views</span>
									<span><strong class="block text-sm text-slate-800">{number.format(tour.enquiries)}</strong>Enquiries</span>
									<span><strong class="block text-sm text-warning">{number.format(tour.funnel.stillOpen.count)}</strong>Open</span>
									<span><strong class="block text-sm text-success">{number.format(tour.funnel.booked.count)}</strong>Booked</span>
								</div>
								{#if moneyLine(tour.funnel.booked.value) || moneyLine(tour.funnel.stillOpen.value)}
									<p class="mt-2 text-[11px] text-slate-400">
										{#if moneyLine(tour.funnel.booked.value)}<span class="text-success">Won {moneyLine(tour.funnel.booked.value)}</span>{/if}
										{#if moneyLine(tour.funnel.booked.value) && moneyLine(tour.funnel.stillOpen.value)}<span class="text-slate-300"> · </span>{/if}
										{#if moneyLine(tour.funnel.stillOpen.value)}<span>Open {moneyLine(tour.funnel.stillOpen.value)}</span>{/if}
									</p>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>

			<div class="hidden overflow-x-auto md:block">
				<table class="w-full text-left text-[12.5px]">
					<thead class="bg-slate-50 text-[10.5px] tracking-wider text-slate-400 uppercase">
						<tr>
							<th class="px-4 py-2.5 font-bold">Tour</th>
							<th class="px-3 py-2.5 text-right font-bold">Views</th>
							<th class="px-3 py-2.5 text-right font-bold">Enquiries</th>
							<th class="px-3 py-2.5 text-right font-bold">Quote rate</th>
							<th class="px-3 py-2.5 text-right font-bold" title="Awaiting a decision">Still open</th>
							<th class="px-3 py-2.5 text-right font-bold" title="Declined, cancelled, or the offer lapsed">Not booked</th>
							<th class="px-3 py-2.5 text-right font-bold" title="Won">Booked</th>
							<th class="px-3 py-2.5 text-right font-bold" title="Enquiries that reached an outcome, per booking">Per booking</th>
							<th class="px-4 py-2.5 text-right font-bold">Reviews</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each p.tours as tour (tour.id)}
							<tr class="transition hover:bg-slate-50">
								<td class="px-4 py-3">
									<a href={`/app/tours/${tour.id}`} class="flex min-w-56 items-center gap-3">
										{#if tour.heroUrl}
											<img src={tour.heroUrl} alt="" class="size-11 rounded-lg object-cover" loading="lazy" />
										{:else}
											<div class="size-11 rounded-lg bg-brand-50"></div>
										{/if}
										<span class="min-w-0">
											<strong class="block truncate font-semibold text-slate-800">{tour.title}</strong>
											<span class="text-[11px] text-slate-400">{tour.status.replaceAll('_', ' ')}</span>
										</span>
									</a>
								</td>
								<td class="px-3 py-3 text-right font-semibold text-slate-800 tabular-nums">{number.format(tour.views)}</td>
								<td class="px-3 py-3 text-right text-slate-600 tabular-nums">{number.format(tour.enquiries)}</td>
								<td class="px-3 py-3 text-right text-slate-600 tabular-nums">{formatRate(tour.quoteRate)}</td>
								{#each [{ b: tour.funnel.stillOpen, tone: 'text-warning' }, { b: tour.funnel.notBooked, tone: 'text-slate-700' }, { b: tour.funnel.booked, tone: 'text-success' }] as cell (cell.tone)}
									{@const short = moneyShort(cell.b.value)}
									<td class="px-3 py-3 text-right tabular-nums">
										<span class="font-semibold {cell.b.count ? cell.tone : 'text-slate-300'}">{number.format(cell.b.count)}</span>
										{#if short}
											<span class="block text-[11px] text-slate-400" title={money(cell.b.value).join(' · ')}>{short}</span>
										{/if}
									</td>
								{/each}
								<td class="px-3 py-3 text-right text-slate-600 tabular-nums">{formatRatio(tour.funnel.requestsPerBooking)}</td>
								<td class="px-4 py-3 text-right text-slate-600 tabular-nums">{tour.reviews.average === null ? '—' : `${tour.reviews.average.toFixed(1)} ★`} <span class="text-slate-400">({tour.reviews.count})</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="px-6 py-12 text-center">
				<p class="text-sm font-semibold text-slate-800">No tours yet</p>
				<p class="mt-1 text-[13px] text-slate-500">Create a listing to start building marketplace performance.</p>
				<a href="/app/tours" class="btn-primary mt-4 inline-flex">Create a tour</a>
			</div>
		{/if}
	</section>

	<p class="px-1 text-[11.5px] leading-5 text-slate-400">
		Still open, not booked and booked account for every enquiry in the period, so they add up to the enquiry count.
		A won enquiry is valued at its booking; anything else at the most recent offer sent, which means a re-quoted
		enquiry counts once, not once per version. Totals are kept per currency and never converted.
		Views are unique per page and anonymous marketplace session within 30 minutes. Quote and booking rates use enquiries created in the selected period. Response time starts at the first sent quotation, delivered staff WhatsApp reply, or explicit “Contacted” action. Reviews are your current published marketplace rating.
		Response timing is captured from this release onward; historical update timestamps are not used as a substitute.
	</p>
</div>
