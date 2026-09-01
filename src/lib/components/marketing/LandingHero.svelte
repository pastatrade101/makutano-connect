<script lang="ts">
	// Hero in the Skywave "business" arrangement: a full-bleed dark band with generous
	// vertical padding and everything centred — eyebrow, display heading, one muted
	// line, then the actions. Their composition, our words.
	let { getStartedHref, trialDays }: { getStartedHref: string; trialDays: number } = $props();

	// The strip the theme fills with client logos. We have no logos to borrow, and the
	// thing a visiting operator most needs to know is that there are TWO products and
	// which one they are looking at — so the strip carries that instead.
	const products = [
		{
			name: 'Makutano Journeys',
			href: 'https://journeys.makutano.co.tz',
			what: 'The public marketplace travellers browse'
		},
		{ name: 'Makutano Connect', href: null, what: 'Where you run the business behind it' }
	];
</script>

<section class="relative overflow-hidden bg-[#201a14]" id="home">
	<div class="hero-wash pointer-events-none absolute inset-0" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-[1320px] px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-10 lg:py-32">
		<p class="text-[13.5px] font-semibold tracking-[0.08em] text-brand-300 sm:text-[14.5px]">For tour operators</p>

		<h1 class="mx-auto mt-4 max-w-4xl text-[34px] leading-[1.08] font-semibold tracking-[-0.03em] text-white sm:text-[50px] lg:text-[58px]">
			Sell your tours to the world.<br class="hidden sm:block" />
			<span class="text-brand-300">Run them from one place.</span>
		</h1>

		<p class="mx-auto mt-6 max-w-2xl text-[16.5px] leading-7 text-blue-100/75 sm:text-[18.5px]">
			List your journeys on <strong class="font-semibold text-white">Makutano Journeys</strong>, our public
			marketplace. When a traveller enquires, it lands in your Connect inbox — and you answer on your
			own WhatsApp number.
		</p>

		<div class="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
			<a href={getStartedHref} class="btn-primary min-h-12 !rounded-full !px-7 text-[15.5px] shadow-[0_14px_34px_rgba(28,132,238,0.35)]">Start listing your tours</a>
			<a
				href="https://journeys.makutano.co.tz"
				target="_blank"
				rel="noopener"
				class="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/25 px-7 text-[15.5px] font-medium text-white transition hover:border-white/50 hover:bg-white/5"
			>
				See the marketplace
				<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
			</a>
		</div>

		<p class="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] font-medium text-blue-100/50 sm:text-[13.5px]">
			<span>{trialDays}-day free trial</span><span class="text-white/20">·</span><span>No card required</span><span class="text-white/20">·</span><span>Your own WhatsApp number</span>
		</p>
	</div>

	<!-- The bottom padding is not decoration: the product card below is pulled up into
	     this band, and without the clearance it would slice straight through the strip. -->
	<div class="relative border-t border-white/10">
		<div class="mx-auto grid max-w-[1320px] gap-px px-4 pb-20 sm:grid-cols-2 sm:px-6 lg:px-10 lg:pb-28">
			{#each products as product (product.name)}
				<div class="flex flex-col gap-0.5 py-5 sm:py-6">
					{#if product.href}
						<a href={product.href} target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-[14px] font-semibold text-white hover:text-brand-300">
							{product.name}
							<svg class="size-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
						</a>
					{:else}
						<span class="text-[14px] font-semibold text-white">{product.name}</span>
					{/if}
					<span class="text-[13px] text-blue-100/60">{product.what}</span>
				</div>
			{/each}
		</div>
	</div>
</section>

<!-- The framed product visual the theme places right after the hero, lifted out of
     the dark band so it overlaps the join. It shows the moment the two products meet:
     a marketplace enquiry sitting in the operator's own inbox. -->
<!-- `relative` so the lifted card paints ABOVE the positioned strip it overlaps rather
     than under it. -->
<section class="relative border-b border-slate-100 bg-[#faf8f5]">
	<div class="mx-auto max-w-[1160px] px-4 pb-16 sm:px-6 sm:pb-20 lg:px-10 lg:pb-24">
		<div class="-mt-14 rounded-2xl bg-brand-500 p-2 shadow-[0_30px_80px_rgba(11,37,69,0.22)] lg:-mt-20">
			<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(50,58,70,0.13)]">
				<div class="flex h-12 items-center justify-between border-b border-slate-200 px-4"><div class="flex items-center gap-2"><span class="flex size-6 items-center justify-center rounded-md bg-brand-500 text-[10px] font-bold text-white">M</span><span class="text-[12.5px] font-semibold text-slate-700">Goldfinch Adventures</span></div><div class="flex items-center gap-2"><span class="hidden rounded-lg bg-slate-50 px-3 py-1.5 text-[10px] text-slate-400 sm:inline">Search travellers, enquiries, references…</span><span class="size-7 rounded-full bg-brand-50"></span></div></div>
				<div class="grid min-h-[390px] grid-cols-1 md:grid-cols-[172px_minmax(0,1fr)_250px]">
					<aside class="hidden border-r border-slate-200 bg-[#fdfcfa] p-3 md:block"><p class="px-2 text-[9px] font-bold tracking-wider text-slate-400 uppercase">General</p>{#each ['Home', 'Inbox', 'Customers'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[11.5px] {item === 'Inbox' ? 'bg-brand-50 font-semibold text-brand-600' : 'text-slate-500'}">{item}</div>{/each}<p class="mt-4 px-2 text-[9px] font-bold tracking-wider text-slate-400 uppercase">Work</p>{#each ['Enquiries', 'Quotations', 'Bookings', 'Trips', 'Payments'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[11.5px] text-slate-500">{item}</div>{/each}</aside>
					<div class="min-w-0 p-4 sm:p-5"><div class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3"><div><div class="flex flex-wrap items-center gap-2"><span class="text-[14.5px] font-semibold text-slate-800">Asha M.</span><span class="rounded-full bg-brand-50 px-2 py-0.5 text-[9px] font-semibold text-brand-600">From Makutano Journeys</span></div><p class="mt-0.5 text-[10px] text-slate-400">4-Day Serengeti &amp; Ngorongoro · 2 adults · 14 Sept</p></div><span class="rounded-full bg-success/10 px-2 py-1 text-[9px] font-semibold text-success">WhatsApp · Robert</span></div><div class="mt-5 max-w-[84%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2.5 text-[12.5px] leading-5 text-slate-700">Hello! Is the 4-day Serengeti still open for two people in September?</div><div class="mt-3 ml-auto max-w-[84%] rounded-xl rounded-tr-sm bg-brand-50 px-3 py-2.5 text-[12.5px] leading-5 text-slate-700">Yes, Asha — sending your quotation now. It includes park fees and the Ngorongoro rim lodge.</div><div class="mt-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div class="flex items-center justify-between"><div><div class="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Quotation</div><div class="mt-1 text-[12.5px] font-semibold text-slate-800">GFA-QT-2026-00041</div></div><span class="rounded-full bg-warning/10 px-2 py-1 text-[9px] font-semibold text-[#a9780c]">Sent · awaiting reply</span></div><div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11.5px]"><span class="text-slate-400">4-Day Serengeti &amp; Ngorongoro · 2 adults</span><span class="font-semibold text-slate-700">TZS 3,400,000</span></div></div></div>
					<aside class="hidden border-l border-slate-200 bg-slate-50/50 p-4 md:block"><p class="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Traveller</p><div class="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div class="text-[11.5px] font-semibold text-slate-800">Asha M.</div><div class="mt-1 text-[10px] text-slate-400">Enquired from your listing · Kenya</div></div><div class="mt-3 rounded-xl border border-slate-200 bg-white p-3"><p class="text-[10px] font-semibold text-slate-700">The listing she found</p><div class="mt-2 text-[11.5px] font-semibold text-slate-800">4-Day Serengeti &amp; Ngorongoro</div><div class="mt-1 text-[10px] text-slate-400">Published on Makutano Journeys</div></div><div class="mt-3 rounded-xl border border-warning/20 bg-warning/5 p-3"><div class="flex items-center justify-between"><span class="text-[10px] font-semibold text-slate-700">Deposit</span><span class="text-[9px] text-[#a9780c]">On acceptance</span></div><div class="mt-2 text-[16.5px] font-bold text-slate-900">TZS 1,020,000</div><p class="mt-1 text-[10px] text-slate-500">Requested once she accepts the quote</p></div></aside>
				</div>
			</div>
		</div>
		<p class="mt-5 text-center text-[14px] text-slate-500">The traveller, the tour she found and the money owed — in one view.</p>
	</div>
</section>

<style>
	.hero-wash {
		background:
			radial-gradient(60rem 30rem at 15% 0%, rgb(224 138 95 / 0.35), transparent 60%),
			radial-gradient(45rem 25rem at 90% 100%, rgb(78 202 194 / 0.18), transparent 60%),
			linear-gradient(rgb(255 255 255 / 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 0.03) 1px, transparent 1px);
		background-size: auto, auto, 38px 38px, 38px 38px;
	}
</style>
