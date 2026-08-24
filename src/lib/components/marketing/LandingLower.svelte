<script lang="ts">
	type Plan = { code: string; name: string; priceMonthly: number; currency: string; highlights: string[] };
	let { data, getStartedHref }: { data: { plans: Plan[] }; getStartedHref: string } = $props();
	const recommended = $derived(data.plans.find((plan) => plan.code === 'BUSINESS')?.code ?? data.plans[Math.min(1, data.plans.length - 1)]?.code);
	const price = (plan: Plan) => plan.priceMonthly === 0 ? 'Free' : `${plan.currency} ${plan.priceMonthly.toLocaleString()}`;
	const columns = $derived(data.plans.length >= 4 ? 'lg:grid-cols-4' : data.plans.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2');
</script>

{#snippet check(text: string)}
	<li class="flex items-start gap-2.5 text-[13px] leading-6 text-slate-600"><span class="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><svg class="size-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m4 10.5 4 4 8-9" /></svg></span><span>{text}</span></li>
{/snippet}

<section class="border-b border-slate-100 bg-white">
	<div class="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-10 lg:py-28">
		<div><p class="eyebrow">Work beside what you have</p><h2 class="section-title">Keep your CMS.<br />Connect the missing pieces.</h2><p class="section-copy">You do not need to rebuild your website or migrate your management system. Makutano Connect sits beside what you already use and adds the infrastructure for customer conversations, WhatsApp, payments and operational workflows.</p><span class="mt-6 inline-flex rounded-full border border-success/20 bg-success/5 px-3 py-1.5 text-[10px] font-semibold text-success">No migration required</span></div>
		<div class="rounded-2xl border border-slate-200 bg-[#f8faff] p-6 shadow-[0_20px_55px_rgba(50,58,70,0.07)] sm:p-8"><div class="grid gap-2 sm:grid-cols-3">{#each ['Existing Website', 'Existing CMS', 'Existing Booking System'] as item}<div class="rounded-xl border border-slate-200 bg-white p-3 text-center text-[10px] font-semibold text-slate-600 shadow-sm">{item}</div>{/each}</div><div class="mx-auto my-3 h-8 w-px border-l border-slate-300"></div><div class="rounded-xl bg-brand-500 p-4 text-center text-sm font-bold text-white shadow-[0_14px_32px_rgba(28,132,238,0.22)]">Makutano Connect</div><div class="mx-auto my-3 h-8 w-px border-l border-slate-300"></div><div class="grid grid-cols-3 gap-2">{#each ['WhatsApp', 'Payments', 'Operations'] as item}<div class="rounded-xl border border-brand-100 bg-brand-50 p-3 text-center text-[10px] font-semibold text-brand-700">{item}</div>{/each}</div></div>
	</div>
</section>

<section id="developers" class="scroll-mt-24 border-b border-slate-100 bg-[#f8faff]">
	<div class="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-10 lg:py-28">
		<div><p class="eyebrow">Developers</p><h2 class="section-title">Built to connect with your stack.</h2><p class="section-copy">Use REST APIs, secure authentication, webhooks and server-side integrations without making the whole product developer-only.</p><div class="mt-6 flex flex-wrap gap-2">{#each ['REST API', 'Secure authentication', 'Webhooks', 'Server-side integrations', 'Documentation'] as item}<span class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600">{item}</span>{/each}</div><a href="/documentation" class="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline">Explore documentation <span>→</span></a></div>
		<div><div class="overflow-hidden rounded-2xl border border-white/10 bg-[#101b2b] shadow-[0_28px_70px_rgba(16,27,43,0.24)]"><div class="flex items-center justify-between border-b border-white/10 px-4 py-3"><span class="font-mono text-[10px] text-slate-400">POST /v1/bookings</span><span class="rounded bg-success/15 px-2 py-0.5 font-mono text-[9px] text-[#70e59a]">201</span></div><pre class="overflow-x-auto p-5 font-mono text-[11px] leading-6 text-slate-300"><code><span>{'{'}</span>
  <span>"customer": {'{'}</span>
    <span>"name": "Asha M.",</span>
    <span>"phone": "+255700000128"</span>
  <span>{'}'},</span>
  <span>"reference": "GFA-BK-128",</span>
  <span>"amount": 850000,</span>
  <span>"currency": "TZS"</span>
<span>{'}'}</span></code></pre></div><div class="mt-4 flex items-center justify-center gap-2 text-[9px] font-semibold text-slate-500"><span class="rounded-lg border border-slate-200 bg-white px-3 py-2">Existing System</span><span>→</span><span class="rounded-lg bg-slate-900 px-3 py-2 text-white">API</span><span>→</span><span class="rounded-lg bg-brand-500 px-3 py-2 text-white">Connect</span><span>→</span><span class="rounded-lg border border-slate-200 bg-white px-3 py-2">Operations</span></div></div>
	</div>
</section>

<section id="solutions" class="scroll-mt-24 border-b border-slate-100 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
		<div class="max-w-2xl"><p class="eyebrow">Adaptive workspaces</p><h2 class="section-title">One platform. Many kinds of business.</h2><p class="section-copy">Connect adapts the workspace to the workflows a business actually uses. Relevance shapes the UI; plan entitlements remain authoritative.</p></div>
		<div class="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{#each [{ t: 'Tour Operators', d: 'Enquiries, quotations, bookings, payments and guest communication.', tag: 'Bookings workspace' }, { t: 'Hotels & Hospitality', d: 'Guest enquiries, reservations, payment requests and communication.', tag: 'Bookings workspace' }, { t: 'Retail & Commerce', d: 'Orders, payment verification and delivery communication.', tag: 'Orders workspace' }, { t: 'Professional Services', d: 'Client enquiries, quotations, payments and follow-up.', tag: 'Service workspace' }, { t: 'Education', d: 'Admissions enquiries, payment communication and support.', tag: 'Bookings workspace' }, { t: 'Government & Public Services', d: 'Citizen enquiries, service notifications and structured communication.', tag: 'Service workspace' }] as item (item.t)}<article class="rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_45px_rgba(50,58,70,0.08)]"><span class="text-[9px] font-bold tracking-wider text-brand-600 uppercase">{item.tag}</span><h3 class="mt-5 text-base font-semibold text-slate-900">{item.t}</h3><p class="mt-2 text-[12px] leading-6 text-slate-500">{item.d}</p></article>{/each}</div>
	</div>
</section>

{#if data.plans.length}
	<section id="pricing" class="scroll-mt-24 border-b border-slate-100 bg-[#f8faff]">
		<div class="mx-auto max-w-[1240px] px-4 py-20 sm:px-6 lg:px-10 lg:py-28">
			<div class="mx-auto max-w-2xl text-center"><p class="eyebrow">Pricing</p><h2 class="section-title">Start simple. Grow into the operation.</h2><p class="section-copy mx-auto">Start with a 14-day free trial. Upgrade when Connect becomes part of your operation.</p></div>
			<div class="mt-12 grid gap-4 sm:grid-cols-2 {columns}">{#each data.plans as plan (plan.code)}<article class="relative flex flex-col rounded-2xl border bg-white p-6 {plan.code === recommended ? 'border-brand-300 shadow-[0_24px_60px_rgba(28,132,238,0.12)] ring-1 ring-brand-200' : 'border-slate-200 shadow-[0_15px_40px_rgba(50,58,70,0.05)]'}">{#if plan.code === recommended}<span class="absolute -top-3 left-5 rounded-full bg-brand-500 px-3 py-1 text-[9px] font-bold text-white shadow-sm">Recommended</span>{/if}<h3 class="text-base font-semibold text-slate-900">{plan.name}</h3><p class="mt-3 text-3xl font-bold tracking-tight text-slate-900">{price(plan)}{#if plan.priceMonthly > 0}<span class="text-[11px] font-normal text-slate-400"> / month</span>{/if}</p><p class="mt-3 text-[11px] leading-5 text-slate-500">A focused workspace with the capabilities included in this plan.</p><ul class="mt-6 flex-1 space-y-2">{#each plan.highlights as highlight (highlight)}{@render check(highlight)}{/each}</ul><a href={getStartedHref} class="mt-7 min-h-11 !rounded-lg {plan.code === recommended ? 'btn-primary' : 'btn-secondary'}">Get Started</a></article>{/each}</div>
		</div>
	</section>
{/if}

<section class="border-b border-slate-100 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-20 sm:px-6 lg:px-10 lg:py-24"><div class="max-w-2xl"><p class="eyebrow">Security & control</p><h2 class="section-title">Business infrastructure deserves serious controls.</h2></div><div class="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{#each [{ t: 'Tenant isolation', d: 'Every business operates in its own server-scoped data boundary.' }, { t: 'Granular permissions', d: 'Staff roles and permissions limit the work each person can access.' }, { t: 'Secure credentials', d: 'Sensitive WhatsApp credentials stay encrypted and server-side.' }, { t: 'Webhook verification', d: 'Inbound provider events are authenticated before processing.' }, { t: 'Auditable payments', d: 'Requests, reports and verification actions keep distinct audit records.' }, { t: 'Role-based access', d: 'Operational and administrative capabilities remain separated.' }] as item (item.t)}<div class="flex gap-3"><span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z" /><path d="m7.5 10 2 2 3.5-4" /></svg></span><div><h3 class="text-[13px] font-semibold text-slate-800">{item.t}</h3><p class="mt-1 text-[11px] leading-5 text-slate-500">{item.d}</p></div></div>{/each}</div></div>
</section>

<section class="bg-[#0e335d] text-white">
	<div class="mx-auto max-w-[1240px] px-4 py-20 text-center sm:px-6 lg:px-10 lg:py-28"><p class="text-[10px] font-bold tracking-[0.18em] text-blue-200 uppercase">Start connecting</p><h2 class="mx-auto mt-4 max-w-3xl text-4xl leading-tight font-bold tracking-[-0.04em] text-white sm:text-5xl">Connect your business<br />without rebuilding it.</h2><p class="mx-auto mt-5 max-w-xl text-sm leading-7 text-blue-100/75">Add WhatsApp, customer operations and payment infrastructure to the systems you already use.</p><div class="mt-8 flex flex-wrap justify-center gap-3"><a href={getStartedHref} class="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-[#0e335d] transition hover:bg-blue-50">Get Started</a><a href="/login" class="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition hover:bg-white/10">Sign In</a></div><p class="mt-5 text-[11px] text-blue-200/70">14-day free trial · No card required</p></div>
</section>
