<script lang="ts">
	/*
	 * The hero states what the product does, in the operator's words.
	 *
	 * The visual is the real chain — enquiry, quotation, booking, trip — because
	 * that chain IS the product. A dashboard of invented numbers would be a claim
	 * about other people's businesses that we cannot support.
	 */
	let {
		getStartedHref,
		signupEnabled,
		hasApps
	}: { getStartedHref: string; signupEnabled: boolean; hasApps: boolean } = $props();

	const chain = [
		{ label: 'New enquiry', detail: 'Sarah M. · 2 travellers', tone: 'brand' },
		{ label: 'Quotation sent', detail: '5 Day Serengeti & Ngorongoro', tone: 'ink' },
		{ label: 'Booking confirmed', detail: 'Travel 18 October', tone: 'ink' },
		{ label: 'Trip preparing', detail: 'Vehicle & team assigned', tone: 'success' }
	];
</script>

<section class="relative overflow-hidden bg-canvas">
	<div class="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(180,83,42,0.10),transparent_70%)]"></div>

	<div class="relative mx-auto grid max-w-[1240px] gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:px-10 lg:pt-20 lg:pb-24">
		<div>
			<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Makutano Connect</p>
			<h1 class="mt-4 text-[34px] leading-[1.08] font-bold tracking-[-0.035em] text-slate-900 text-balance sm:text-5xl lg:text-[56px]">
				Run your tour business from one place.
			</h1>
			<p class="mt-5 max-w-xl text-[15.5px] leading-7 text-slate-600">
				From the first traveller enquiry to the final day of the trip, Makutano Connect keeps your
				enquiries, WhatsApp conversations, quotations, bookings, trips, team and vehicles together.
			</p>

			<div class="mt-8 flex flex-col gap-3 sm:flex-row">
				<a
					href={getStartedHref}
					class="inline-flex min-h-12 items-center justify-center rounded-lg bg-brand-600 px-6 text-sm font-semibold text-white transition hover:bg-brand-700"
				>
					{signupEnabled ? 'Start your tour business' : 'Sign in to Connect'}
				</a>
				{#if signupEnabled}
					<a
						href="/login"
						class="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
					>
						Sign in
					</a>
				{/if}
			</div>

			<p class="mt-5 text-[13px] text-slate-500">
				{#if hasApps}
					Available on the web, iPhone and Android.
				{:else}
					Works in any browser, on a laptop or a phone.
				{/if}
			</p>

			<p class="mt-6 max-w-lg rounded-panel border border-brand-200 bg-brand-50/50 px-4 py-3 text-[13.5px] leading-6 text-slate-700">
				<strong class="font-semibold text-slate-900">New to Makutano?</strong>
				We'll guide you step by step. You don't need to set everything up at once.
			</p>
		</div>

		<!-- The chain, not a chart. Each card is a real stage with real fields. -->
		<div class="relative">
			<div class="space-y-2.5">
				{#each chain as step, i (step.label)}
					<div
						class="relative rounded-panel border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] {step.tone ===
						'brand'
							? 'border-brand-300'
							: step.tone === 'success'
								? 'border-success/30'
								: 'border-slate-200'}"
					>
						<div class="flex items-center justify-between gap-3">
							<p class="text-sm font-semibold text-slate-900">{step.label}</p>
							<span
								class="size-2 shrink-0 rounded-full {step.tone === 'brand'
									? 'bg-brand-500'
									: step.tone === 'success'
										? 'bg-success'
										: 'bg-slate-300'}"
							></span>
						</div>
						<p class="mt-1 text-[13px] text-slate-500">{step.detail}</p>
					</div>
					{#if i < chain.length - 1}
						<div class="flex justify-center py-0.5" aria-hidden="true">
							<svg class="size-4 text-slate-300" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75">
								<path d="M8 3v10m0 0 3.5-3.5M8 13 4.5 9.5" />
							</svg>
						</div>
					{/if}
				{/each}
			</div>
			<p class="mt-4 text-center text-[12.5px] text-slate-400">One traveller, from first message to the road.</p>
		</div>
	</div>
</section>
