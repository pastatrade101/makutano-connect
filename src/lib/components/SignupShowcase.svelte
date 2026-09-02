<script lang="ts">
	/**
	 * The panel beside the signup form.
	 *
	 * Deliberately NOT the pattern every marketplace signup uses — a stack of
	 * icons, a borrowed statistic and a testimonial from somebody who may or may
	 * not exist. PRODUCT.md rules that out in as many words: a claim the software
	 * cannot enforce does not go on a page. So there is no invented visitor
	 * count, no "N+ verified operators", and no quoted operator.
	 *
	 * What is left is the one thing a directory cannot show: the relay an
	 * operator's work actually runs through after they list. That, and four
	 * numbers COUNTED from the catalogue at request time.
	 *
	 * Sibling to LoginShowcase and deliberately different from it — that panel is
	 * a carousel of app screens, this one is a single continuous idea. Two dark
	 * panels that looked alike would make signup feel like a page you had
	 * already seen.
	 */
	import { onMount } from 'svelte';
	import { decodeBasemap, fitProjection, outlinePath, type BasemapDoc } from '$lib/geo/basemap';

	/** Counted server-side; shaped here so this component never imports $lib/server. */
	type Scale = { journeys: number; destinations: number; stays: number; styles: number };

	let { scale = null }: { scale?: Scale | null } = $props();

	/**
	 * The relay, as an operator experiences it.
	 *
	 * Each line is something the software genuinely does today — the listing, the
	 * enquiry, the operator's own WhatsApp number, the quotation with its public
	 * link, the booking, the payment. Nothing here is aspirational.
	 */
	const RELAY = [
		{ title: 'Your tour goes live', caption: 'Published to Makutano Journeys.' },
		{ title: 'A traveller enquires', caption: 'Straight from your tour page.' },
		{ title: 'You reply on WhatsApp', caption: 'Your own number, not ours.' },
		{ title: 'You send a quotation', caption: 'A link they can open and read.' },
		{ title: 'They accept', caption: 'The quotation becomes a booking.' },
		{ title: 'Payment is recorded', caption: 'And the trip is yours to run.' }
	];

	/** Counted numbers only. A missing count is omitted, never shown as zero. */
	const FIGURES = $derived(
		scale
			? [
					{ value: scale.journeys, label: 'journeys published' },
					{ value: scale.destinations, label: 'destinations mapped' },
					{ value: scale.stays, label: 'lodges and camps' },
					{ value: scale.styles, label: 'travel styles' }
				].filter((f) => f.value > 0)
			: []
	);

	let active = $state(0);
	let reducedMotion = $state(false);
	let paused = $state(false);

	onMount(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (reducedMotion = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	$effect(() => {
		if (reducedMotion || paused) return;
		const timer = setInterval(() => (active = (active + 1) % RELAY.length), 2100);
		return () => clearInterval(timer);
	});

	/*
	 * Tanzania, as a watermark.
	 *
	 * The real national outline the marketplace draws its maps from, not a traced
	 * decoration — it is already bundled at /geo/tz-basemap.json. Fetched after
	 * mount so the 42 KB never delays the form, and if it does not arrive the
	 * watermark simply is not there. A signup page must not depend on scenery.
	 */
	let outline = $state<string | null>(null);
	let outlineH = $state(520);

	onMount(() => {
		let live = true;
		fetch('/geo/tz-basemap.json')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((doc: BasemapDoc) => {
				if (!live) return;
				const map = decodeBasemap(doc);
				const project = fitProjection(doc.bbox, 520, 10);
				outline = outlinePath(map, project);
				outlineH = project.height;
			})
			.catch(() => {});
		return () => (live = false);
	});
</script>

<section
	class="showcase relative hidden min-h-screen overflow-hidden bg-[#241d16] md:flex md:items-center md:justify-center"
	aria-label="What happens after you sign up"
	onmouseenter={() => (paused = true)}
	onmouseleave={() => (paused = false)}
	onfocusin={() => (paused = true)}
	onfocusout={() => (paused = false)}
>
	<div class="pointer-events-none absolute inset-0" aria-hidden="true"></div>

	{#if outline}
		<!-- Bled off the corner on purpose: a country you are looking at part of,
		     not a logo floating in the middle of a panel. -->
		<svg
			class="pointer-events-none absolute -right-28 -bottom-24 w-[680px] opacity-[0.09]"
			viewBox="0 0 520 {outlineH}"
			aria-hidden="true"
		>
			<path d={outline} fill="none" stroke="#e5c3ad" stroke-width="1.25" />
		</svg>
	{/if}

	<div class="relative z-10 w-full max-w-xl px-8 py-12 lg:px-12 xl:px-16">
		<div class="flex items-center gap-2 text-[11.5px] font-bold tracking-[0.18em] text-brand-200 uppercase">
			<span class="size-1.5 rounded-full bg-[#7fc79f] shadow-[0_0_0_5px_rgba(127,199,159,0.12)]"></span>
			Makutano Journeys
		</div>

		<h2 class="mt-3 text-[30px] leading-[1.12] font-bold tracking-[-0.035em] text-white lg:text-[38px]">
			List once.<br />Run everything after.
		</h2>
		<p class="mt-3 max-w-md text-[14.5px] leading-6 text-white/70">
			A directory stops at the listing. This is what the rest of the journey looks like once a
			traveller finds you.
		</p>

		<!-- The relay. One continuous rail, with the beat that is lit travelling
		     down it — the loop the product is built around, not a bullet list. -->
		<ol class="relay mt-9 space-y-0">
			{#each RELAY as step, i (step.title)}
				<li class="relative flex gap-4 pb-5 last:pb-0">
					<div class="relative flex flex-col items-center">
						<span
							class="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition-colors duration-500
							{i === active
								? 'border-brand-400 bg-brand-500 text-white'
								: 'border-white/20 bg-white/5 text-white/45'}"
						>
							{i + 1}
						</span>
						{#if i < RELAY.length - 1}
							<span class="w-px flex-1 bg-white/12"></span>
						{/if}
					</div>
					<div class="min-w-0 pt-0.5">
						<div
							class="text-[14.5px] font-semibold transition-colors duration-500 {i === active
								? 'text-white'
								: 'text-white/65'}"
						>
							{step.title}
						</div>
						<div class="text-[12.5px] leading-5 text-white/45">{step.caption}</div>
					</div>
				</li>
			{/each}
		</ol>

		{#if FIGURES.length}
			<!-- Counted at request time. If the count fails the strip is absent
			     rather than showing a zero that would read as "nobody is here". -->
			<div class="mt-10 border-t border-white/12 pt-6">
				<p class="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
					In the catalogue right now
				</p>
				<dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
					{#each FIGURES as figure (figure.label)}
						<div>
							<dt class="sr-only">{figure.label}</dt>
							<dd>
								<span class="block text-[26px] leading-none font-bold tracking-[-0.03em] text-white">
									{figure.value}
								</span>
								<span class="mt-1.5 block text-[11.5px] leading-4 text-white/50">
									{figure.label}
								</span>
							</dd>
						</div>
					{/each}
				</dl>
			</div>
		{/if}

		<p class="mt-8 max-w-md text-[12.5px] leading-5 text-white/45">
			One record follows it the whole way — the same customer, quotation and booking, from the first
			message to the last payment. On your own WhatsApp number, with your own pricing.
		</p>
	</div>
</section>

<style>
	.showcase > :global(div:first-child) {
		background-image:
			radial-gradient(circle at 12% 8%, rgb(224 138 95 / 0.34), transparent 30rem),
			radial-gradient(circle at 92% 88%, rgb(61 107 82 / 0.22), transparent 26rem),
			linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px);
		background-size: auto, auto, 34px 34px, 34px 34px;
		mask-image: linear-gradient(to bottom right, black, rgb(0 0 0 / 0.55));
	}
</style>
