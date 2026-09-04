<script lang="ts">
	/*
	 * Answers checked against the code, not aspiration.
	 *
	 * Two are deliberately negative — no automatic AI messages, no GPS hardware —
	 * because the operator's real fear is that the software will do something on
	 * their behalf, or cost them equipment money, before they understand it.
	 */
	let {
		marketplaceUrl,
		hasApps
	}: { marketplaceUrl: string; hasApps: boolean } = $props();

	const faqs = [
		{
			q: 'What is the difference between Makutano Connect and Makutano Journeys?',
			a: 'Journeys is the public marketplace travellers browse. Connect is your private workspace where the work happens — enquiries, conversations, quotations, bookings and trips. You run the business in Connect; travellers find you on Journeys.'
		},
		{
			q: 'Do I need to download the app?',
			a: hasApps
				? 'No. Connect works in any browser on a laptop or a phone. The apps are there if you prefer them, and they use the same account.'
				: 'No. Connect runs in any browser, including on a phone. Mobile apps are being tested and will use the same account when they are published.'
		},
		{
			q: 'Do I need a website?',
			a: 'No. Your tours get a public page on Makutano Journeys, and quotations get their own link you can send to a traveller. If you do have a website, you can keep it.'
		},
		{
			q: 'Do I need WhatsApp?',
			a: 'No. You can run enquiries, quotations, bookings and trips without it. Connecting your business WhatsApp number just brings those conversations into the same place as everything else — you can add it later.'
		},
		{
			q: 'Can my staff use Connect?',
			a: 'Yes. Invite them and each person gets their own login, with control over what they can see and do. That is better than sharing one account, because you can see who did what and remove someone without changing everyone’s password.'
		},
		{
			q: 'Do I need GPS devices?',
			a: 'No. Tracking is optional, and where you do want it, a driver’s phone can do the job — there is no hardware to buy.'
		},
		{
			q: 'Can I manage trips without GPS tracking?',
			a: 'Yes, completely. Assigning a vehicle and a team, preparing the trip and completing it all work whether or not any vehicle is tracked.'
		},
		{
			q: 'Does Makutano automatically send AI messages to my customers?',
			a: 'No. Nothing is sent to a traveller unless you send it. Messages go out from your own WhatsApp number, and you write them.'
		}
	];
</script>

<section class="bg-canvas">
	<div class="mx-auto max-w-[900px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<h2 class="text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
			Questions operators actually ask
		</h2>
		<div class="mt-8 divide-y divide-slate-200 border-y border-slate-200">
			{#each faqs as faq (faq.q)}
				<details class="group py-4">
					<summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold text-slate-900">
						{faq.q}
						<svg class="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
					</summary>
					<p class="mt-3 max-w-2xl text-[14px] leading-7 text-slate-600">{faq.a}</p>
				</details>
			{/each}
		</div>
		<p class="mt-6 text-[13.5px] text-slate-500">
			Still unsure? <a href="mailto:connect@makutano.co.tz" class="font-medium text-brand-600 hover:underline">Ask us</a>,
			or <a href={marketplaceUrl} target="_blank" rel="noopener" class="font-medium text-brand-600 hover:underline">look at Journeys</a> to see what travellers see.
		</p>
	</div>
</section>
