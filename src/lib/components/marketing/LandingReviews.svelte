<script lang="ts">
	/*
	 * The loop closes at the VERIFIED REVIEW, and stops there.
	 *
	 * Reputation scoring and reputation-driven marketplace ranking are designed
	 * but not built — docs/PRODUCT.md says so plainly, and `recommended` is an
	 * editorial order today. Promising better discovery would be exactly the kind
	 * of claim the product rule forbids: if it cannot be derived from a record,
	 * it does not go on a page.
	 */
	let { marketplaceUrl }: { marketplaceUrl: string } = $props();
</script>

<section class="border-y border-slate-200 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
			<div>
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">After the trip</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
					Complete the trip. Earn a review that means something.
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					A review on Makutano is tied to a booking that actually completed. It cannot be posted by
					someone who never travelled, and it cannot be bought.
				</p>
				<p class="mt-3 text-[15.5px] leading-7 text-slate-600">
					That is worth more than a star rating anyone can leave: it says a real traveller went on a
					real trip that your company ran.
				</p>
				<a
					href={marketplaceUrl}
					target="_blank"
					rel="noopener"
					class="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50"
				>
					See operator pages on Journeys
					<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
				</a>
			</div>

			<ol class="space-y-0">
				{#each [{ t: 'The trip completes', d: 'The booking is finished, not cancelled or refunded.' }, { t: 'That traveller becomes eligible', d: 'Only they can review it — the invitation comes from the booking.' }, { t: 'They write the review', d: 'About a trip that demonstrably happened.' }, { t: 'It appears on your Journeys listing', d: 'Next to the tour they actually took.' }] as s, i (s.t)}
					<li class="grid grid-cols-[auto_1fr] gap-x-4">
						<div class="flex flex-col items-center">
							<span class="mt-1 flex size-7 items-center justify-center rounded-full border border-slate-200 bg-white text-[11.5px] font-bold text-slate-500">{i + 1}</span>
							{#if i < 3}<span class="w-px flex-1 bg-slate-200" aria-hidden="true"></span>{/if}
						</div>
						<div class="pb-6">
							<p class="text-[15.5px] font-semibold text-slate-900">{s.t}</p>
							<p class="mt-1 text-[13.5px] leading-6 text-slate-500">{s.d}</p>
						</div>
					</li>
				{/each}
			</ol>
		</div>
	</div>
</section>
