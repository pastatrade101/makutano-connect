<script lang="ts">
	// Public product site. Marketing only — every button targets a real route, every
	// plan comes from the database, and the vignettes are built from the same design
	// system the portal uses, so nothing here promises a product that does not exist.
	let { data } = $props();

	const getStartedHref = $derived(data.signupEnabled ? '/signup' : '/login');
	let menuOpen = $state(false);

	// Pricing only renders when plans exist, so its nav link must follow the section.
	const NAV = $derived([
		{ href: '/#product', label: 'Product' },
		{ href: '/#how-it-works', label: 'How it Works' },
		{ href: '/#developers', label: 'Developers' },
		{ href: '/#use-cases', label: 'Use Cases' },
		...(data.plans.length ? [{ href: '/#pricing', label: 'Pricing' }] : [])
	]);

	const price = (p: { priceMonthly: number; currency: string }) =>
		p.priceMonthly === 0 ? 'Free' : `${p.currency} ${p.priceMonthly.toLocaleString()}`;

	// Full literal strings so Tailwind's scanner actually generates them.
	const planCols = $derived(data.plans.length >= 4 ? 'lg:grid-cols-4' : data.plans.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2');
</script>

<svelte:head>
	<title>Makutano Connect — WhatsApp, booking and payment infrastructure</title>
	<meta
		name="description"
		content="Connect WhatsApp, bookings and payments to the systems your business already uses — without rebuilding your CMS. Makutano Connect powers the infrastructure behind modern customer journeys."
	/>
</svelte:head>

{#snippet arrowDown()}
	<div class="flex justify-center py-1" aria-hidden="true">
		<svg class="size-4 text-slate-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3v12m0 0 4-4m-4 4-4-4" /></svg>
	</div>
{/snippet}

{#snippet chip(label: string)}
	<span class="rounded-panel border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 shadow-panel">{label}</span>
{/snippet}

{#snippet check()}
	<svg class="mt-0.5 size-4 shrink-0 text-brand-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 10.5 4 4 8-9" /></svg>
{/snippet}

<div class="bg-white text-slate-700">
	<!-- ============================================================= Navigation -->
	<header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur">
		<nav class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-8">
			<a href="/" class="flex items-center gap-2.5" aria-label="Makutano Connect home">
				<div class="flex size-8 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
				<span class="text-[15px] font-bold tracking-tight text-slate-800">Makutano <span class="text-brand-500">Connect</span></span>
			</a>

			<div class="hidden items-center gap-6 md:flex">
				{#each NAV as item (item.href)}
					<a href={item.href} class="text-[13.5px] font-medium text-slate-500 transition hover:text-slate-800">{item.label}</a>
				{/each}
			</div>

			<div class="hidden items-center gap-2 md:flex">
				<a href="/login" class="btn-secondary !py-1.5 text-[13px]">Sign In</a>
				<a href={getStartedHref} class="btn-primary !py-1.5 text-[13px]">Get Started</a>
			</div>

			<button
				class="rounded-panel p-2 text-slate-500 hover:bg-slate-100 md:hidden"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
			>
				{#if menuOpen}
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg>
				{:else}
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>
				{/if}
			</button>
		</nav>

		{#if menuOpen}
			<div class="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
				{#each NAV as item (item.href)}
					<a href={item.href} class="block border-b border-slate-50 py-3 text-sm font-medium text-slate-600" onclick={() => (menuOpen = false)}>{item.label}</a>
				{/each}
				<div class="mt-3 grid grid-cols-2 gap-2">
					<a href="/login" class="btn-secondary" onclick={() => (menuOpen = false)}>Sign In</a>
					<a href={getStartedHref} class="btn-primary" onclick={() => (menuOpen = false)}>Get Started</a>
				</div>
			</div>
		{/if}
	</header>

	<main>
	<!-- =================================================================== Hero -->
	<section class="border-b border-slate-100">
		<div class="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:px-8 lg:py-24">
			<div>
				<p class="mb-3 text-[11px] font-bold tracking-widest text-brand-600 uppercase">Makutano Connect</p>
				<h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15]">
					The infrastructure behind modern customer journeys.
				</h1>
				<p class="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-500">
					Connect WhatsApp, bookings and payments to the systems your business already uses — without rebuilding your CMS.
				</p>
				<div class="mt-7 flex flex-wrap items-center gap-2.5">
					<a href={getStartedHref} class="btn-primary !px-5 !py-2.5">Get Started</a>
					<a href="/documentation" class="btn-secondary !px-5 !py-2.5">View API Documentation</a>
				</div>
				<p class="mt-5 text-xs text-slate-400">Your business stays where it is. Makutano Connect powers the infrastructure behind it.</p>
			</div>

			<!-- Architecture: connects systems, never replaces them -->
			<div class="card p-5 sm:p-6">
				<p class="mb-4 text-center text-[10px] font-bold tracking-widest text-slate-400 uppercase">How it fits together</p>
				<div class="flex justify-center">{@render chip('Customer')}</div>
				{@render arrowDown()}
				<div class="flex flex-wrap justify-center gap-2">
					{@render chip('Your website')}
					{@render chip('WhatsApp')}
				</div>
				{@render arrowDown()}
				<div class="flex justify-center">
					<span class="flex items-center gap-2 rounded-panel bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-panel">
						<span class="flex size-5 items-center justify-center rounded bg-white/20 text-[11px] font-bold">M</span>
						Makutano Connect
					</span>
				</div>
				{@render arrowDown()}
				<div class="flex flex-wrap justify-center gap-2">
					{@render chip('Bookings')}
					{@render chip('Payments')}
					{@render chip('Messaging')}
				</div>
				{@render arrowDown()}
				<div class="flex justify-center">
					<span class="rounded-panel border border-dashed border-slate-300 bg-slate-50 px-4 py-1.5 text-[12.5px] font-medium text-slate-500">Your existing CMS</span>
				</div>
			</div>
		</div>
	</section>

	<!-- =========================================================== How it works -->
	<section id="how-it-works" class="scroll-mt-20 border-b border-slate-100 bg-slate-50/60">
		<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
			<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">How it works</p>
			<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Three steps, no migration.</h2>
			<div class="mt-8 grid gap-4 sm:grid-cols-3">
				{#each [{ n: '01', t: 'Connect', d: 'Connect WhatsApp Business and configure the services your business needs.' }, { n: '02', t: 'Integrate', d: 'Connect your website, CMS, booking system or application through Makutano Connect APIs and integrations.' }, { n: '03', t: 'Operate', d: 'Keep managing customers from your existing systems while Makutano Connect handles the communication and transaction infrastructure.' }] as step (step.n)}
					<div class="card p-5">
						<span class="text-[13px] font-bold text-brand-500">{step.n}</span>
						<h3 class="mt-1.5 text-[15px] font-semibold text-slate-800">{step.t}</h3>
						<p class="mt-1.5 text-[13px] leading-relaxed text-slate-500">{step.d}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ========================================================== Core platform -->
	<section id="product" class="scroll-mt-20 border-b border-slate-100">
		<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
			<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Core platform</p>
			<h2 class="mt-2 max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
				One infrastructure layer for conversations, bookings and payments.
			</h2>

			<div class="mt-10 space-y-12">
				<!-- WhatsApp -->
				<div class="grid items-center gap-8 lg:grid-cols-2">
					<div>
						<h3 class="text-lg font-semibold text-slate-800">WhatsApp Infrastructure</h3>
						<p class="mt-2 text-sm leading-relaxed text-slate-500">
							Use your own WhatsApp Business number and manage every customer conversation through one reliable infrastructure.
						</p>
						<ul class="mt-4 space-y-2 text-[13.5px] text-slate-600">
							{#each ['Connect your own WhatsApp Business number', 'Shared team inbox with conversation assignment', 'Presence and ownership — see who is viewing and replying', 'Automated customer notifications through approved templates'] as f (f)}
								<li class="flex gap-2">{@render check()}<span>{f}</span></li>
							{/each}
						</ul>
					</div>
					<div class="card p-4">
						<div class="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
							<div class="text-[13px] font-semibold text-slate-700">Amina Hassan</div>
							<span class="text-[11px] text-slate-400">Neema is typing…</span>
						</div>
						<div class="space-y-2.5">
							<div class="max-w-[80%] rounded-panel bg-slate-100 px-3 py-2 text-[13px] text-slate-700">Habari! Do you still have space for Saturday?</div>
							<div class="ml-auto max-w-[80%] rounded-panel bg-brand-50 px-3 py-2 text-[13px] text-slate-700">
								Yes — two seats left. I'll send the details and a payment request now.
								<span class="mt-1 flex justify-end text-brand-500" aria-hidden="true">
									<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m2 10.5 3 3 5.5-6M9 13l1.5 1.5L16 8" /></svg>
								</span>
							</div>
						</div>
						<div class="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
							<span class="badge bg-brand-50 text-brand-600">Assigned to Neema</span>
							<span class="badge bg-success/10 text-success">Open</span>
						</div>
					</div>
				</div>

				<!-- Bookings -->
				<div class="grid items-center gap-8 lg:grid-cols-2">
					<div class="lg:order-2">
						<h3 class="text-lg font-semibold text-slate-800">Booking Infrastructure</h3>
						<p class="mt-2 text-sm leading-relaxed text-slate-500">
							Accept and manage booking requests while your website stays the source of truth for what you sell.
						</p>
						<ul class="mt-4 space-y-2 text-[13.5px] text-slate-600">
							{#each ['Accept and manage booking requests', 'Connect booking flows to your existing website', 'Synchronize booking information with your systems', 'Keep business data accessible from your existing CMS'] as f (f)}
								<li class="flex gap-2">{@render check()}<span>{f}</span></li>
							{/each}
						</ul>
					</div>
					<div class="card p-4 lg:order-1">
						<div class="flex items-start justify-between gap-2">
							<div>
								<div class="font-mono text-[11px] text-slate-400">GFA-BK-2026-00214</div>
								<div class="mt-0.5 text-[14px] font-semibold text-slate-800">7 Day Serengeti Migration Safari</div>
								<div class="mt-0.5 text-[12px] text-slate-400">Synced from your website · 2 adults · 14–20 Sep</div>
							</div>
							<span class="badge bg-success/10 text-success">Confirmed</span>
						</div>
						<div class="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[12.5px]">
							<div><span class="text-slate-400">Total</span> <span class="font-semibold text-slate-700">USD 4,900</span></div>
							<div><span class="text-slate-400">Balance</span> <span class="font-semibold text-warning">USD 2,450</span></div>
						</div>
					</div>
				</div>

				<!-- Payments -->
				<div class="grid items-center gap-8 lg:grid-cols-2">
					<div>
						<h3 class="text-lg font-semibold text-slate-800">Payment Infrastructure</h3>
						<p class="mt-2 text-sm leading-relaxed text-slate-500">
							Connect payment requests to bookings and customer journeys, and keep every claim honest until it is verified.
						</p>
						<ul class="mt-4 space-y-2 text-[13.5px] text-slate-600">
							{#each ['Connect payment requests to bookings and customer journeys', 'Track payment status from request to verification', 'Send payment confirmations and customer notifications', 'Deposits and balances tracked against every booking'] as f (f)}
								<li class="flex gap-2">{@render check()}<span>{f}</span></li>
							{/each}
						</ul>
					</div>
					<div class="card p-4">
						<div class="flex items-center justify-between">
							<div class="text-[13px] font-semibold text-slate-700">Payment request · TZS 850,000</div>
							<span class="badge bg-success/10 text-success">Verified</span>
						</div>
						<ol class="mt-3 space-y-2 border-t border-slate-100 pt-3">
							{#each [{ s: 'Requested', d: 'Sent on WhatsApp with your payment details', done: true }, { s: 'Reported', d: 'Customer tapped "I have paid" — recorded as a claim', done: true }, { s: 'Verified', d: 'Your team confirmed the money and the booking advanced', done: true }] as step (step.s)}
								<li class="flex items-start gap-2.5 text-[12.5px]">
									<span class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full {step.done ? 'bg-success/15 text-success' : 'bg-slate-100 text-slate-300'}">
										<svg class="size-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m4 10.5 4 4 8-9" /></svg>
									</span>
									<span><b class="font-semibold text-slate-700">{step.s}</b> <span class="text-slate-400">— {step.d}</span></span>
								</li>
							{/each}
						</ol>
					</div>
				</div>

				<!-- Team -->
				<div class="grid items-center gap-8 lg:grid-cols-2">
					<div class="lg:order-2">
						<h3 class="text-lg font-semibold text-slate-800">Team Operations</h3>
						<p class="mt-2 text-sm leading-relaxed text-slate-500">
							One company number, many staff — with ownership, visibility and workload that stay clear as the team grows.
						</p>
						<ul class="mt-4 space-y-2 text-[13.5px] text-slate-600">
							{#each ['Shared inbox with conversation ownership and assignment', 'Team presence — see who is viewing and replying', 'Filters and workload visibility per person', 'Customer history behind every conversation'] as f (f)}
								<li class="flex gap-2">{@render check()}<span>{f}</span></li>
							{/each}
						</ul>
					</div>
					<div class="card p-4 lg:order-1">
						<div class="grid grid-cols-3 gap-2 border-b border-slate-100 pb-3 text-center">
							{#each [{ l: 'Open', v: '12' }, { l: 'Unassigned', v: '3' }, { l: 'Replies today', v: '48' }] as t (t.l)}
								<div>
									<div class="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{t.l}</div>
									<div class="text-lg font-bold tabular-nums text-slate-800">{t.v}</div>
								</div>
							{/each}
						</div>
						<ul class="mt-3 space-y-2">
							{#each [{ n: 'Neema Joseph', r: 'Manager', s: '4 open · 21 replies today', online: true }, { n: 'Robert Mushi', r: 'Agent', s: '6 open · 18 replies today', online: true }, { n: 'Grace Temba', r: 'Agent', s: '2 open · 9 replies today', online: false }] as m (m.n)}
								<li class="flex items-center gap-2.5 text-[12.5px]">
									<span class="relative flex size-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-600">
										{m.n.slice(0, 1)}
										{#if m.online}<span class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-white bg-success"></span>{/if}
									</span>
									<span class="font-medium text-slate-700">{m.n}</span>
									<span class="text-[11px] text-slate-400">{m.r}</span>
									<span class="ml-auto text-[11px] text-slate-400">{m.s}</span>
								</li>
							{/each}
						</ul>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ============================================= Works with existing systems -->
	<section class="scroll-mt-20 border-b border-slate-100 bg-slate-50/60">
		<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Built to work with existing systems</p>
				<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Keep your CMS. Connect the missing pieces.</h2>
				<p class="mt-3 text-sm leading-relaxed text-slate-500">
					You do not need to rebuild your website or migrate your management system. Makutano Connect sits beside what you already run and adds the
					infrastructure it is missing.
				</p>
			</div>

			<div class="mx-auto mt-8 max-w-2xl">
				<div class="card p-5 sm:p-6">
					<div class="flex flex-wrap justify-center gap-2">
						{@render chip('Existing Website')}
						{@render chip('Existing CMS')}
						{@render chip('Existing Booking System')}
					</div>
					{@render arrowDown()}
					<div class="flex justify-center">
						<span class="rounded-panel border border-brand-200 bg-brand-50 px-5 py-2 text-[13px] font-semibold text-brand-700">Makutano Connect API</span>
					</div>
					{@render arrowDown()}
					<div class="flex flex-wrap justify-center gap-2">
						{@render chip('WhatsApp')}
						{@render chip('Payments')}
						{@render chip('Booking Infrastructure')}
						{@render chip('Customer Communication')}
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- ============================================================= Developers -->
	<section id="developers" class="scroll-mt-20 border-b border-slate-100">
		<div class="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:px-8 lg:py-20">
			<div>
				<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Developers</p>
				<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Built to connect with your stack.</h2>
				<p class="mt-3 text-sm leading-relaxed text-slate-500">
					A booking created on your website reaches Connect in one call — with your own references, so your CMS remains the source of truth.
				</p>
				<ul class="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px] text-slate-600">
					{#each ['REST APIs', 'Webhooks', 'Secure authentication', 'Tenant isolation', 'Reusable integrations', 'Production-ready infrastructure'] as f (f)}
						<li class="flex gap-2">{@render check()}<span>{f}</span></li>
					{/each}
				</ul>
				<a href="/documentation" class="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
					Explore API Documentation
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10h12m0 0-4-4m4 4-4 4" /></svg>
				</a>
			</div>

			<div class="overflow-hidden rounded-panel border border-slate-200 bg-slate-900 shadow-panel">
				<div class="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
					<span class="font-mono text-[11px] text-slate-400">POST /api/v1/booking-requests</span>
					<span class="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">201</span>
				</div>
				<pre class="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-slate-300"><code
						>{`{
  "customer": { "firstName": "Amina", "phone": "+255 700 000 001" },
  "items": [{
    "title": "7 Day Serengeti Migration Safari",
    "externalReference": "your-cms-tour-118",
    "startDate": "2026-09-14T00:00:00Z",
    "unitPrice": "2450.00"
  }],
  "source": "WEBSITE"
}`}</code
					></pre>
			</div>
		</div>
	</section>

	<!-- ============================================================== Use cases -->
	<section id="use-cases" class="scroll-mt-20 border-b border-slate-100 bg-slate-50/60">
		<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
			<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Use cases</p>
			<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">One platform, many kinds of business.</h2>
			<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each [{ t: 'Tour Operators', d: 'Enquiries, quotations, bookings and trip communication — while your website stays your tour catalog.' }, { t: 'Hotels & Hospitality', d: 'Reservation requests, deposits and guest messaging connected to your property systems.' }, { t: 'Retail & E-commerce', d: 'Customer orders, payment requests and delivery updates over the number customers already know.' }, { t: 'Professional Services', d: 'Enquiries, quotations and payment collection for teams that quote for their work.' }, { t: 'Education', d: 'Admissions enquiries, fee requests and parent communication through one shared inbox.' }, { t: 'Government & Public Services', d: 'Citizen enquiries and service communication with assignment, visibility and auditability.' }] as u (u.t)}
					<div class="card p-5 transition hover:border-brand-300">
						<h3 class="text-[14.5px] font-semibold text-slate-800">{u.t}</h3>
						<p class="mt-1.5 text-[13px] leading-relaxed text-slate-500">{u.d}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ================================================================ Pricing -->
	{#if data.plans.length}
		<section id="pricing" class="scroll-mt-20 border-b border-slate-100">
			<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
				<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Pricing</p>
				<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Start free, grow when you do.</h2>
				<p class="mt-3 max-w-xl text-sm text-slate-500">Every account starts with a free trial. Nothing is charged until you choose a plan.</p>
				<div class="mt-8 grid gap-4 sm:grid-cols-2 {planCols}">
					{#each data.plans as plan (plan.code)}
						<div class="card flex flex-col p-5">
							<h3 class="text-[14.5px] font-semibold text-slate-800">{plan.name}</h3>
							<div class="mt-2">
								<span class="text-2xl font-bold tracking-tight text-slate-900">{price(plan)}</span>
								{#if plan.priceMonthly > 0}<span class="text-xs text-slate-400"> / month</span>{/if}
							</div>
							<ul class="mt-4 flex-1 space-y-2 text-[13px] text-slate-600">
								{#each plan.highlights as h (h)}
									<li class="flex gap-2">{@render check()}<span>{h}</span></li>
								{/each}
							</ul>
							<a href={getStartedHref} class="btn-secondary mt-5 w-full">Get Started</a>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	<!-- =============================================================== Security -->
	<section id="security" class="scroll-mt-20 border-b border-slate-100 bg-slate-50/60">
		<div class="mx-auto max-w-6xl px-4 py-14 lg:px-8 lg:py-20">
			<p class="text-[11px] font-bold tracking-widest text-brand-600 uppercase">Security & reliability</p>
			<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Boring where it matters.</h2>
			<div class="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each [{ t: 'Secure credentials', d: 'WhatsApp tokens are encrypted at rest and never reach the browser.' }, { t: 'Tenant isolation', d: 'Every record is scoped to one business — enforced on the server, on every request.' }, { t: 'Controlled API access', d: 'Scoped API keys grant exactly the access an integration needs, nothing more.' }, { t: 'Webhook verification', d: 'Inbound webhooks are signature-verified before anything is processed.' }, { t: 'Reliable infrastructure', d: 'Idempotent APIs and retried background jobs, so a flaky network never loses a booking.' }, { t: 'Auditability', d: 'Administrative and sensitive actions leave an audit trail.' }] as s (s.t)}
					<div class="flex gap-3">
						<span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-panel border border-slate-200 bg-white text-brand-500">
							<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z" /><path d="m7.5 10 2 2 3.5-4" /></svg>
						</span>
						<div>
							<h3 class="text-[13.5px] font-semibold text-slate-800">{s.t}</h3>
							<p class="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{s.d}</p>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- ============================================================== Final CTA -->
	<section class="border-b border-slate-100">
		<div class="mx-auto max-w-6xl px-4 py-16 text-center lg:px-8 lg:py-24">
			<h2 class="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Connect your business without rebuilding it.</h2>
			<p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-slate-500">
				Add WhatsApp, bookings and payment infrastructure to the systems you already use.
			</p>
			<div class="mt-7 flex flex-wrap items-center justify-center gap-2.5">
				<a href={getStartedHref} class="btn-primary !px-6 !py-2.5">Get Started</a>
				<a href="/login" class="btn-secondary !px-6 !py-2.5">Sign In</a>
			</div>
		</div>
	</section>
	</main>

	<!-- ================================================================= Footer -->
	<footer class="bg-white">
		<div class="mx-auto max-w-6xl px-4 py-10 lg:px-8">
			<div class="flex flex-col gap-8 sm:flex-row sm:justify-between">
				<div class="max-w-xs">
					<div class="flex items-center gap-2.5">
						<div class="flex size-7 items-center justify-center rounded-panel bg-brand-500 text-xs font-bold text-white">M</div>
						<span class="text-sm font-bold tracking-tight text-slate-800">Makutano <span class="text-brand-500">Connect</span></span>
					</div>
					<p class="mt-3 text-[12.5px] leading-relaxed text-slate-400">Booking, WhatsApp and payment infrastructure for modern businesses.</p>
				</div>
				<div class="grid grid-cols-2 gap-8 sm:grid-cols-3">
					<div>
						<p class="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Platform</p>
						<ul class="mt-3 space-y-2 text-[13px]">
							<li><a href="/#product" class="text-slate-500 hover:text-slate-800">Product</a></li>
							<li><a href="/#developers" class="text-slate-500 hover:text-slate-800">Developers</a></li>
							<li><a href="/documentation" class="text-slate-500 hover:text-slate-800">API Documentation</a></li>
							<li><a href="/#security" class="text-slate-500 hover:text-slate-800">Security</a></li>
						</ul>
					</div>
					<div>
						<p class="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Company</p>
						<ul class="mt-3 space-y-2 text-[13px]">
							<li><a href="mailto:connect@makutano.co.tz" class="text-slate-500 hover:text-slate-800">Contact</a></li>
							<li><a href="/legal/terms" class="text-slate-500 hover:text-slate-800">Terms</a></li>
							<li><a href="/legal/privacy" class="text-slate-500 hover:text-slate-800">Privacy</a></li>
						</ul>
					</div>
					<div>
						<p class="text-[10px] font-bold tracking-widest text-slate-400 uppercase">Account</p>
						<ul class="mt-3 space-y-2 text-[13px]">
							<li><a href="/login" class="text-slate-500 hover:text-slate-800">Sign In</a></li>
							{#if data.signupEnabled}<li><a href="/signup" class="text-slate-500 hover:text-slate-800">Create an account</a></li>{/if}
						</ul>
					</div>
				</div>
			</div>
			<div class="mt-8 border-t border-slate-100 pt-4 text-[11px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</div>
		</div>
	</footer>
</div>
