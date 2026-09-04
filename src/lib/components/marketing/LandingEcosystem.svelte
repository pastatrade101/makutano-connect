<script lang="ts">
	/*
	 * The whole loop on one screen, in words an operator already uses.
	 *
	 * Deliberately no "CRM", "SaaS", "API" or "multi-tenant". The reader is a tour
	 * operator, not a software buyer.
	 */
	let { marketplaceUrl }: { marketplaceUrl: string } = $props();

	const journey = [
		{ where: 'Makutano Journeys', what: 'A traveller finds your tour', note: 'Or they message you directly. Either way, the work continues in one place.' },
		{ where: 'Connect', what: 'The enquiry arrives', note: 'Attached to the tour they were looking at, with their dates and details.' },
		{ where: 'Connect', what: 'You talk on WhatsApp', note: 'Your own business number, in a shared inbox your team can see.' },
		{ where: 'Connect', what: 'You send a quotation', note: 'Priced from the enquiry, so nothing is retyped.' },
		{ where: 'Connect', what: 'They accept — it becomes a booking', note: 'The customer, the dates and the price carry across.' },
		{ where: 'Connect', what: 'You record payment as it comes in', note: 'Money moves the way it always has. Connect keeps track of what is paid.' },
		{ where: 'Connect', what: 'The trip is prepared', note: 'Assign the driver, the guide and the vehicle. See what is still missing.' },
		{ where: 'On the road', what: 'The trip runs', note: 'If the vehicle is tracked, you can see where it is.' },
		{ where: 'Makutano Journeys', what: 'A verified review', note: 'Written by someone who actually travelled with you.' }
	];
</script>

<section id="loop" class="border-y border-slate-200 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="max-w-2xl">
			<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">How it fits together</p>
			<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
				One journey. One connected system.
			</h2>
			<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
				A traveller may find you on
				<a href={marketplaceUrl} target="_blank" rel="noopener" class="font-medium text-brand-600 underline-offset-2 hover:underline">Makutano Journeys</a>,
				message you on WhatsApp, or send an enquiry from your own page. However they arrive, the
				work continues in Makutano Connect.
			</p>
		</div>

		<ol class="mt-10 space-y-0">
			{#each journey as step, i (step.what)}
				<li class="relative grid grid-cols-[auto_1fr] gap-x-4 sm:gap-x-6">
					<!-- the spine -->
					<div class="flex flex-col items-center">
						<span
							class="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-bold {step.where ===
							'Makutano Journeys'
								? 'border-brand-300 bg-brand-50 text-brand-700'
								: 'border-slate-200 bg-white text-slate-500'}"
						>{i + 1}</span>
						{#if i < journey.length - 1}
							<span class="w-px flex-1 bg-slate-200" aria-hidden="true"></span>
						{/if}
					</div>
					<div class="pb-7">
						<p class="text-[11px] font-bold tracking-[0.14em] uppercase {step.where === 'Makutano Journeys' ? 'text-brand-600' : 'text-slate-400'}">
							{step.where}
						</p>
						<p class="mt-1 text-[15.5px] font-semibold text-slate-900">{step.what}</p>
						<p class="mt-1 max-w-xl text-[13.5px] leading-6 text-slate-500">{step.note}</p>
					</div>
				</li>
			{/each}
		</ol>

		<!-- The advantage, stated concretely. Each line is a real foreign key, not a
		     slogan: this is what "one connected system" actually buys the operator. -->
		<div class="mt-4 rounded-panel border border-brand-200 bg-brand-50/40 p-5 lg:p-6">
			<h3 class="text-[17px] font-bold tracking-[-0.01em] text-slate-900">
				Why keeping it together is the point
			</h3>
			<p class="mt-2 max-w-2xl text-[14px] leading-7 text-slate-600">
				Every step knows the one before it, so nothing is retyped and nothing is lost between apps:
			</p>
			<ul class="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
				{#each ['The enquiry knows which tour they were reading', 'The WhatsApp conversation knows which customer it belongs to', 'The quotation is priced from the enquiry', 'The booking carries the quotation across', 'The trip knows the booking it came from', 'The review knows the trip actually happened'] as line (line)}
					<li class="flex gap-2.5 text-[13.5px] leading-6 text-slate-700">
						<svg class="mt-1 size-4 shrink-0 text-brand-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
						{line}
					</li>
				{/each}
			</ul>
			<p class="mt-4 max-w-2xl text-[13.5px] leading-6 text-slate-600">
				Add your WhatsApp number and those conversations join the same chain. A directory can list
				your tours; it never finds out whether the trip happened.
			</p>
		</div>
	</div>
</section>
