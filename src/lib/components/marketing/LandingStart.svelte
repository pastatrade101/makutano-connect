<script lang="ts">
	/*
	 * "Where do I start?" — the section a nervous first-time operator needs most.
	 *
	 * Three steps, each saying what happens NEXT, because the fear is not the form:
	 * it is not knowing what the form leads to.
	 */
	let {
		getStartedHref,
		signupEnabled,
		marketplaceUrl
	}: { getStartedHref: string; signupEnabled: boolean; marketplaceUrl: string } = $props();

	const steps = [
		{
			n: '1',
			title: 'Create your operator account',
			body: 'Tell us about your tour company and create your Makutano workspace.',
			next: 'You land in your Connect workspace, with a short checklist waiting.',
			cta: signupEnabled ? { label: 'Create my account', href: getStartedHref } : null
		},
		{
			n: '2',
			title: 'Set up your company',
			body: 'Add your company profile, the phone number customers should reach you on, and how you operate.',
			next: 'Your business details appear on quotations and on your Journeys listing.',
			reassure: "You don't have to complete everything on your first visit.",
			cta: { label: 'Set up my company', href: '/app/settings' }
		},
		{
			n: '3',
			title: 'Add your first tour',
			body: 'Where it goes, how long it takes, the itinerary, what is included and the photos. Serengeti, Ngorongoro, Zanzibar, Kilimanjaro — whatever you actually run.',
			next: 'Once the tour is published, travellers can find it on Makutano Journeys.',
			cta: { label: 'Add my first tour', href: '/app/tours' }
		}
	];
</script>

<section id="start" class="bg-canvas">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="max-w-2xl">
			<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Getting started</p>
			<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
				Starting from zero? Here's exactly what happens.
			</h2>
			<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
				No technical setup guide. No giant checklist. Follow these three steps and Connect will tell
				you what comes next.
			</p>
		</div>

		<div class="mt-10 grid gap-4 lg:grid-cols-3">
			{#each steps as step (step.n)}
				<div class="flex flex-col rounded-panel border border-slate-200 bg-white p-5">
					<span class="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-[15px] font-bold text-brand-700">{step.n}</span>
					<h3 class="mt-4 text-[17px] font-bold tracking-[-0.01em] text-slate-900">{step.title}</h3>
					<p class="mt-2 text-[13.5px] leading-6 text-slate-600">{step.body}</p>

					{#if step.reassure}
						<p class="mt-3 text-[13px] leading-6 font-medium text-brand-700">{step.reassure}</p>
					{/if}

					<div class="mt-4 rounded-lg bg-slate-50 px-3 py-2.5">
						<p class="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">What happens next</p>
						<p class="mt-1 text-[13px] leading-6 text-slate-600">{step.next}</p>
					</div>

					{#if step.cta}
						<a
							href={step.cta.href}
							class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-brand-200 bg-brand-50/60 px-4 text-[13.5px] font-semibold text-brand-700 transition hover:bg-brand-50"
						>{step.cta.label}</a>
					{/if}
				</div>
			{/each}
		</div>

		<!-- §4: what Journeys is, in one plain paragraph -->
		<div class="mt-12 grid gap-6 rounded-panel border border-slate-200 bg-white p-6 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:p-8">
			<div>
				<h3 class="text-[22px] font-bold tracking-[-0.02em] text-slate-900">Now travellers can find you.</h3>
				<p class="mt-3 max-w-xl text-[14.5px] leading-7 text-slate-600">
					Someone searching for a five-day Serengeti safari can open your tour on Makutano Journeys,
					read the itinerary, see what is included, and send you an enquiry.
				</p>
				<p class="mt-3 max-w-xl text-[14.5px] leading-7 text-slate-600">
					You don't have to copy that enquiry anywhere. It arrives in Connect, already attached to
					the tour they were reading.
				</p>
				<a
					href={marketplaceUrl}
					target="_blank"
					rel="noopener"
					class="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50"
				>
					Explore Makutano Journeys
					<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
				</a>
			</div>
			<div class="rounded-panel border border-slate-200 bg-canvas p-4">
				<p class="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">Connect runs the tour</p>
				<p class="mt-1 text-[13.5px] leading-6 text-slate-600">Pricing, availability, the itinerary and the operations.</p>
				<div class="my-3 h-px bg-slate-200"></div>
				<p class="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">Journeys helps travellers discover it</p>
				<p class="mt-1 text-[13.5px] leading-6 text-slate-600">The public page, the search, the comparison.</p>
			</div>
		</div>
	</div>
</section>
