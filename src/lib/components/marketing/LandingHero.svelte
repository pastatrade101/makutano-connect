<script lang="ts">
	// Hero in the Skywave "business" arrangement: a full-bleed dark band with generous
	// vertical padding and everything centred — eyebrow, display heading, one muted
	// line, then the actions. Their composition, our words.
	let { getStartedHref }: { getStartedHref: string } = $props();

	// The strip the theme fills with client logos. We have no logos to borrow, so it
	// carries the real journey the product runs instead of invented social proof.
	const journey = ['Enquiry', 'Conversation', 'Quotation', 'Payment', 'Booking', 'Trip updates'];
</script>

<section class="relative overflow-hidden bg-[#0b2545]" id="home">
	<div class="hero-wash pointer-events-none absolute inset-0" aria-hidden="true"></div>

	<div class="relative mx-auto max-w-[1320px] px-4 py-24 text-center sm:px-6 lg:px-10 lg:py-32">
		<p class="text-[13px] font-semibold tracking-[0.08em] text-brand-300">Customer operations infrastructure</p>

		<h1 class="mx-auto mt-4 max-w-4xl text-[38px] leading-[1.08] font-semibold tracking-[-0.03em] text-white sm:text-[50px] lg:text-[58px]">
			The infrastructure behind <span class="text-brand-300">modern customer journeys.</span>
		</h1>

		<p class="mx-auto mt-6 max-w-2xl text-[16px] leading-7 text-blue-100/70 sm:text-[17px]">
			Connect WhatsApp, customer conversations, bookings, orders, payments and your team — without rebuilding your existing systems.
		</p>

		<div class="mt-9 flex flex-wrap justify-center gap-3">
			<a href={getStartedHref} class="btn-primary min-h-12 !rounded-full !px-7 text-[14px] shadow-[0_14px_34px_rgba(28,132,238,0.35)]">Get Started</a>
			<a href="/documentation" class="inline-flex min-h-12 items-center justify-center rounded-full border border-white/25 px-7 text-[14px] font-medium text-white transition hover:border-white/50 hover:bg-white/5">
				View Documentation
			</a>
		</div>

		<p class="mt-6 flex flex-wrap items-center justify-center gap-x-2 text-[12px] font-medium text-blue-100/50">
			<span>14-day free trial</span><span class="text-white/20">·</span><span>No card required</span><span class="text-white/20">·</span><span>Keep your existing systems</span>
		</p>
	</div>

	<div class="relative border-t border-white/10">
		<div class="mx-auto flex max-w-[1320px] flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-5 sm:px-6 lg:px-10">
			{#each journey as stage, i (stage)}
				<span class="text-[12px] font-medium text-blue-100/60">{stage}</span>
				{#if i < journey.length - 1}
					<svg class="size-3.5 text-white/25" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 4l6 6-6 6" /></svg>
				{/if}
			{/each}
		</div>
	</div>
</section>

<!-- The framed product visual the theme places right after the hero, lifted out of
     the dark band so it overlaps the join. -->
<section class="border-b border-slate-100 bg-[#f6f9fd]">
	<div class="mx-auto max-w-[1160px] px-4 pb-20 sm:px-6 lg:px-10 lg:pb-24">
		<div class="-mt-14 rounded-2xl bg-brand-500 p-2 shadow-[0_30px_80px_rgba(11,37,69,0.22)] lg:-mt-20">
			<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(50,58,70,0.13)]">
				<div class="flex h-12 items-center justify-between border-b border-slate-200 px-4"><div class="flex items-center gap-2"><span class="flex size-6 items-center justify-center rounded-md bg-brand-500 text-[9px] font-bold text-white">M</span><span class="text-[11px] font-semibold text-slate-700">Goldfinch Adventures</span></div><div class="flex items-center gap-2"><span class="hidden rounded-lg bg-slate-50 px-3 py-1.5 text-[9px] text-slate-400 sm:inline">Search customers, bookings, references…</span><span class="size-7 rounded-full bg-brand-50"></span></div></div>
				<div class="grid min-h-[390px] grid-cols-1 md:grid-cols-[172px_minmax(0,1fr)_250px]">
					<aside class="hidden border-r border-slate-200 bg-[#fbfcfe] p-3 md:block"><p class="px-2 text-[8px] font-bold tracking-wider text-slate-400 uppercase">General</p>{#each ['Home', 'Inbox', 'Customers'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[10px] {item === 'Inbox' ? 'bg-brand-50 font-semibold text-brand-600' : 'text-slate-500'}">{item}</div>{/each}<p class="mt-4 px-2 text-[8px] font-bold tracking-wider text-slate-400 uppercase">Work</p>{#each ['Enquiries', 'Bookings', 'Quotations', 'Payments'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[10px] text-slate-500">{item}</div>{/each}</aside>
					<div class="min-w-0 p-4 sm:p-5"><div class="flex items-start justify-between border-b border-slate-100 pb-3"><div><div class="flex items-center gap-2"><h3 class="text-[13px] font-semibold text-slate-800">Asha M.</h3><span class="rounded-full bg-success/10 px-2 py-0.5 text-[8px] font-semibold text-success">WhatsApp</span></div><p class="mt-0.5 text-[9px] text-slate-400">Robert is typing… · Neema is viewing</p></div><span class="rounded-full bg-brand-50 px-2 py-1 text-[8px] font-semibold text-brand-600">Assigned to Robert</span></div><div class="mt-5 max-w-[84%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2.5 text-[11px] leading-5 text-slate-700">Hello! Do you still have space for the Serengeti Safari this Saturday?</div><div class="mt-3 ml-auto max-w-[84%] rounded-xl rounded-tr-sm bg-brand-50 px-3 py-2.5 text-[11px] leading-5 text-slate-700">Yes, Asha. I’ll send the booking details and payment request now.</div><div class="mt-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div class="flex items-center justify-between"><div><div class="text-[8px] font-bold tracking-wider text-slate-400 uppercase">Booking</div><div class="mt-1 text-[11px] font-semibold text-slate-800">GFA-BK-2026-00128</div></div><span class="rounded-full bg-warning/10 px-2 py-1 text-[8px] font-semibold text-[#a9780c]">Awaiting payment</span></div><div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px]"><span class="text-slate-400">Serengeti Safari</span><span class="font-semibold text-slate-700">TZS 850,000</span></div></div></div>
					<aside class="hidden border-l border-slate-200 bg-slate-50/50 p-4 md:block"><p class="text-[8px] font-bold tracking-wider text-slate-400 uppercase">Customer context</p><div class="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div class="text-[10px] font-semibold text-slate-800">Asha M.</div><div class="mt-1 text-[9px] text-slate-400">2 conversations · 1 booking</div></div><div class="mt-3 rounded-xl border border-warning/20 bg-warning/5 p-3"><div class="flex items-center justify-between"><span class="text-[9px] font-semibold text-slate-700">Payment</span><span class="text-[8px] text-[#a9780c]">Verify</span></div><div class="mt-2 text-[15px] font-bold text-slate-900">TZS 850,000</div><p class="mt-1 text-[9px] text-slate-500">Customer reported payment</p><button class="mt-3 w-full rounded-lg bg-brand-500 py-2 text-[9px] font-semibold text-white">Verify payment</button></div></aside>
				</div>
			</div>
		</div>
		<p class="mt-5 text-center text-[12.5px] text-slate-500">The customer, conversation and transaction — in one view.</p>
	</div>
</section>

<style>
	.hero-wash {
		background:
			radial-gradient(60rem 30rem at 15% 0%, rgb(28 132 238 / 0.35), transparent 60%),
			radial-gradient(45rem 25rem at 90% 100%, rgb(78 202 194 / 0.18), transparent 60%),
			linear-gradient(rgb(255 255 255 / 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 0.03) 1px, transparent 1px);
		background-size: auto, auto, 38px 38px, 38px 38px;
	}
</style>
