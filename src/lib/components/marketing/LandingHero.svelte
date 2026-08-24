<script lang="ts">
	let { getStartedHref }: { getStartedHref: string } = $props();
	const activity = [
		{ text: 'New WhatsApp enquiry', tone: 'bg-brand-500' },
		{ text: 'Assigned to Robert', tone: 'bg-purple' },
		{ text: 'Payment requested', tone: 'bg-brand-500' },
		{ text: 'Customer: I have paid', tone: 'bg-warning' },
		{ text: 'Payment verified', tone: 'bg-success' },
		{ text: 'Booking confirmed', tone: 'bg-success' }
	];
</script>

{#snippet arrow()}
	<svg class="mx-auto size-4 text-slate-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3v12m0 0 4-4m-4 4-4-4" /></svg>
{/snippet}

<section class="hero-grid relative overflow-hidden border-b border-slate-100 bg-[#f8fbff]">
	<div class="pointer-events-none absolute inset-0" aria-hidden="true"></div>
	<div class="relative mx-auto max-w-[1320px] px-4 pt-16 pb-14 sm:px-6 lg:px-10 lg:pt-24 lg:pb-20">
		<div class="grid items-center gap-12 lg:grid-cols-[0.92fr_1.08fr] xl:gap-16">
			<div>
				<p class="text-[11px] font-bold tracking-[0.19em] text-brand-600 uppercase">Customer operations infrastructure</p>
				<h1 class="mt-5 max-w-[680px] text-[40px] leading-[1.05] font-bold tracking-[-0.048em] text-slate-900 sm:text-[50px] lg:text-[60px]">
					The infrastructure behind <span class="text-brand-500">modern customer journeys.</span>
				</h1>
				<p class="mt-6 max-w-[620px] text-[16px] leading-7 text-slate-500 sm:text-[17px]">
					Connect WhatsApp, customer conversations, bookings, orders, payments and your team — without rebuilding your existing systems.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<a href={getStartedHref} class="btn-primary min-h-12 !rounded-lg !px-6 text-[14px] shadow-[0_12px_28px_rgba(28,132,238,0.22)]">Get Started</a>
					<a href="/documentation" class="btn-secondary min-h-12 !rounded-lg !px-6 text-[14px]">View Documentation</a>
				</div>
				<p class="mt-5 flex flex-wrap items-center gap-x-2 text-[11px] font-medium text-slate-400"><span>14-day free trial</span><span class="text-slate-300">·</span><span>No card required</span><span class="text-slate-300">·</span><span>Keep your existing systems</span></p>
			</div>

			<div class="rounded-2xl border border-slate-200/90 bg-white/95 p-5 shadow-[0_30px_80px_rgba(50,58,70,0.12)] sm:p-7">
				<div class="flex items-center justify-between"><p class="text-[10px] font-bold tracking-[0.16em] text-slate-400 uppercase">Live journey orchestration</p><span class="flex items-center gap-1.5 text-[9px] font-semibold text-success"><span class="activity-dot size-1.5 rounded-full bg-success"></span>Connected</span></div>
				<div class="mt-6 grid grid-cols-[1fr_auto] gap-4">
					<div class="min-w-0 space-y-2.5">
						<div class="mx-auto w-fit rounded-lg border border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold text-slate-700 shadow-sm">Customer</div>
						{@render arrow()}
						<div class="flex justify-center gap-2"><span class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-medium text-slate-600">WhatsApp</span><span class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-medium text-slate-600">Website</span></div>
						{@render arrow()}
						<div class="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-xl bg-[#0e335d] px-4 py-4 text-center text-white shadow-[0_16px_35px_rgba(14,51,93,0.24)]"><div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300 to-transparent"></div><div class="text-[9px] font-semibold tracking-[0.15em] text-blue-200 uppercase">Orchestration layer</div><div class="mt-1 text-[14px] font-bold">Makutano Connect</div></div>
						<div class="mx-auto h-5 w-px bg-slate-200"></div>
						<div class="grid grid-cols-3 gap-2"><span class="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-[9px] font-medium text-slate-600 shadow-sm">Conversations</span><span class="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-[9px] font-medium text-slate-600 shadow-sm">Transactions</span><span class="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-[9px] font-medium text-slate-600 shadow-sm">Payments</span></div>
						{@render arrow()}
						<div class="mx-auto w-fit rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2 text-[10px] font-semibold text-slate-500">Your existing system</div>
					</div>
					<div class="hidden w-[168px] space-y-2 border-l border-slate-100 pl-4 sm:block">
						<p class="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Activity</p>
						{#each activity as item, index (item.text)}
							<div class="activity-item flex gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-[9px] font-medium text-slate-600" style="animation-delay:{index * 160}ms"><span class="mt-1 size-1.5 shrink-0 rounded-full {item.tone}"></span>{item.text}</div>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="mx-auto mt-14 max-w-[1120px]">
			<div class="mb-4 flex items-end justify-between gap-4"><div><p class="text-[10px] font-bold tracking-[0.16em] text-brand-600 uppercase">Inside Connect</p><h2 class="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">The customer, conversation and transaction—in one view.</h2></div><span class="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-medium text-slate-500 sm:block">Real workflows · no vanity charts</span></div>
			<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(50,58,70,0.13)]">
				<div class="flex h-12 items-center justify-between border-b border-slate-200 px-4"><div class="flex items-center gap-2"><span class="flex size-6 items-center justify-center rounded-md bg-brand-500 text-[9px] font-bold text-white">M</span><span class="text-[11px] font-semibold text-slate-700">Goldfinch Adventures</span></div><div class="flex items-center gap-2"><span class="hidden rounded-lg bg-slate-50 px-3 py-1.5 text-[9px] text-slate-400 sm:inline">Search customers, bookings, references…</span><span class="size-7 rounded-full bg-brand-50"></span></div></div>
				<div class="grid min-h-[390px] grid-cols-1 md:grid-cols-[172px_minmax(0,1fr)_250px]">
					<aside class="hidden border-r border-slate-200 bg-[#fbfcfe] p-3 md:block"><p class="px-2 text-[8px] font-bold tracking-wider text-slate-400 uppercase">General</p>{#each ['Home', 'Inbox', 'Customers'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[10px] {item === 'Inbox' ? 'bg-brand-50 font-semibold text-brand-600' : 'text-slate-500'}">{item}</div>{/each}<p class="mt-4 px-2 text-[8px] font-bold tracking-wider text-slate-400 uppercase">Work</p>{#each ['Enquiries', 'Bookings', 'Quotations', 'Payments'] as item}<div class="mt-1 rounded-lg px-2 py-2 text-[10px] text-slate-500">{item}</div>{/each}</aside>
					<div class="min-w-0 p-4 sm:p-5"><div class="flex items-start justify-between border-b border-slate-100 pb-3"><div><div class="flex items-center gap-2"><h3 class="text-[13px] font-semibold text-slate-800">Asha M.</h3><span class="rounded-full bg-success/10 px-2 py-0.5 text-[8px] font-semibold text-success">WhatsApp</span></div><p class="mt-0.5 text-[9px] text-slate-400">Robert is typing… · Neema is viewing</p></div><span class="rounded-full bg-brand-50 px-2 py-1 text-[8px] font-semibold text-brand-600">Assigned to Robert</span></div><div class="mt-5 max-w-[84%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2.5 text-[11px] leading-5 text-slate-700">Hello! Do you still have space for the Serengeti Safari this Saturday?</div><div class="mt-3 ml-auto max-w-[84%] rounded-xl rounded-tr-sm bg-brand-50 px-3 py-2.5 text-[11px] leading-5 text-slate-700">Yes, Asha. I’ll send the booking details and payment request now.</div><div class="mt-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div class="flex items-center justify-between"><div><div class="text-[8px] font-bold tracking-wider text-slate-400 uppercase">Booking</div><div class="mt-1 text-[11px] font-semibold text-slate-800">GFA-BK-2026-00128</div></div><span class="rounded-full bg-warning/10 px-2 py-1 text-[8px] font-semibold text-[#a9780c]">Awaiting payment</span></div><div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px]"><span class="text-slate-400">Serengeti Safari</span><span class="font-semibold text-slate-700">TZS 850,000</span></div></div></div>
					<aside class="hidden border-l border-slate-200 bg-slate-50/50 p-4 md:block"><p class="text-[8px] font-bold tracking-wider text-slate-400 uppercase">Customer context</p><div class="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div class="text-[10px] font-semibold text-slate-800">Asha M.</div><div class="mt-1 text-[9px] text-slate-400">2 conversations · 1 booking</div></div><div class="mt-3 rounded-xl border border-warning/20 bg-warning/5 p-3"><div class="flex items-center justify-between"><span class="text-[9px] font-semibold text-slate-700">Payment</span><span class="text-[8px] text-[#a9780c]">Verify</span></div><div class="mt-2 text-[15px] font-bold text-slate-900">TZS 850,000</div><p class="mt-1 text-[9px] text-slate-500">Customer reported payment</p><button class="mt-3 w-full rounded-lg bg-brand-500 py-2 text-[9px] font-semibold text-white">Verify payment</button></div></aside>
				</div>
			</div>
		</div>
	</div>
</section>

<section id="how-it-works" class="scroll-mt-24 border-b border-slate-100 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
		<div class="max-w-2xl"><p class="eyebrow">How it works</p><h2 class="section-title">Three steps. No migration.</h2><p class="section-copy">Connect fits beside your current systems, then gives your team one operational layer for customer work.</p></div>
		<div class="step-line relative mt-12 grid gap-4 md:grid-cols-3">
			{#each [{ n: '01', t: 'Connect', d: 'Connect WhatsApp Business and the customer-facing channels you need.' }, { n: '02', t: 'Integrate', d: 'Connect your website, CMS, booking system or business software using APIs and webhooks.' }, { n: '03', t: 'Operate', d: 'Your team manages conversations, transactions, payments and follow-up through Connect.' }] as item (item.n)}
				<div class="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(50,58,70,0.06)]"><span class="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-xs font-bold text-brand-600">{item.n}</span><h3 class="mt-6 text-lg font-semibold text-slate-900">{item.t}</h3><p class="mt-2 text-[13px] leading-6 text-slate-500">{item.d}</p></div>
			{/each}
		</div>
	</div>
</section>

<style>
	.hero-grid > :global(div:first-child) { background-image: radial-gradient(circle at 8% 12%, rgb(28 132 238 / 0.09), transparent 31rem), radial-gradient(circle at 92% 18%, rgb(78 202 194 / 0.08), transparent 26rem), linear-gradient(rgb(50 58 70 / 0.035) 1px, transparent 1px), linear-gradient(90deg, rgb(50 58 70 / 0.035) 1px, transparent 1px); background-size: auto, auto, 36px 36px, 36px 36px; mask-image: linear-gradient(to bottom, black, rgb(0 0 0 / 0.5) 72%, transparent); }
	.activity-dot { animation: pulse 2.4s ease-in-out infinite; }
	.activity-item { animation: appear 500ms ease both; }
	@keyframes pulse { 50% { box-shadow: 0 0 0 5px rgb(34 197 94 / 0.12); } }
	@keyframes appear { from { opacity: 0; transform: translateY(5px); } }
	@media (min-width: 768px) { .step-line::before { content: ''; position: absolute; top: 2.25rem; left: 10%; right: 10%; height: 1px; background: linear-gradient(90deg, transparent, rgb(164 205 249), transparent); } }
</style>
