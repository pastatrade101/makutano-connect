<script lang="ts">
	import SectionHead from './SectionHead.svelte';
	type Plan = { code: string; name: string; priceMonthly: number; currency: string; highlights: string[] };
	let { data, getStartedHref }: { data: { plans: Plan[] }; getStartedHref: string } = $props();
	const recommended = $derived(data.plans.find((plan) => plan.code === 'BUSINESS')?.code ?? data.plans[Math.min(1, data.plans.length - 1)]?.code);
	const price = (plan: Plan) => plan.priceMonthly === 0 ? 'Free' : `${plan.currency} ${plan.priceMonthly.toLocaleString()}`;
	const columns = $derived(data.plans.length >= 4 ? 'lg:grid-cols-4' : data.plans.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2');

	// The real listing lifecycle (DRAFT → SUBMITTED → IN_REVIEW → APPROVED → PUBLISHED,
	// with CHANGES_REQUESTED carrying the reviewer's note back). Stated plainly, because
	// an operator who discovers the review queue at submit time feels tricked by it.
	const review = [
		{ t: 'You write the listing', d: 'Itinerary, destinations, photos, price, what is included — all of it yours to edit.' },
		{ t: 'You submit it for review', d: 'Nothing goes public until you decide it is ready and send it in.' },
		{ t: 'The Makutano team reads it', d: 'We approve it, or send it back with a note saying exactly what needs changing.' },
		{ t: 'It goes live on Journeys', d: 'Published on the marketplace. You can unpublish it yourself at any time.' }
	];

	// Mirrors the actual signup path: /signup → /verify-email → /onboarding → /app.
	const start = [
		{ t: 'Create your account', d: 'Your name, your email, a password. One screen.' },
		{ t: 'Confirm your email', d: 'We send a link. Clicking it is the whole step.' },
		{ t: 'Tell us about your business', d: 'Business name, country, phone number and what you run. This is where you pick your plan.' },
		{ t: 'Add your first tour', d: 'Write the itinerary, add the photos, submit it for review.' }
	];
</script>

{#snippet check(text: string)}
	<li class="flex items-start gap-2.5 text-[14.5px] leading-6 text-slate-600"><span class="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><svg class="size-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m4 10.5 4 4 8-9" /></svg></span><span>{text}</span></li>
{/snippet}

<section id="listings" class="scroll-mt-24 border-b border-slate-100 bg-white">
	<div class="mx-auto grid max-w-[1240px] items-start gap-10 px-4 py-[70px] sm:px-6 sm:py-[90px] lg:grid-cols-[0.85fr_1.15fr] lg:gap-16 lg:px-10">
		<div>
			<SectionHead
				align="left"
				label="Getting listed"
				title="Every listing is reviewed before it goes live."
				subtitle="Operators cannot publish themselves onto Makutano Journeys. That is deliberate: a traveller in another country, sending a deposit to a company they have never met, is trusting the marketplace to have looked first."
				icon="M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z"
			/>
			<p class="mt-6 text-[14px] leading-7 text-slate-500">
				Review usually costs you one round of edits. It buys every operator on the marketplace a
				credibility none of us could establish alone.
			</p>
		</div>

		<ol class="space-y-3">
			{#each review as step, index (step.t)}
				<li class="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(50,58,70,0.05)]">
					<span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-[13px] font-bold text-brand-600">{index + 1}</span>
					<div class="min-w-0"><h3 class="text-[15.5px] font-semibold text-slate-900">{step.t}</h3><p class="mt-1 text-[13.5px] leading-6 text-slate-500">{step.d}</p></div>
				</li>
			{/each}
		</ol>
	</div>
</section>

<section id="start" class="scroll-mt-24 border-b border-slate-100 bg-[#faf8f5]">
	<div class="mx-auto max-w-[1240px] px-4 py-[70px] sm:px-6 sm:py-[90px] lg:px-10">
		<SectionHead
			label="Getting started"
			title="Four steps to your first listing."
			subtitle="No sales call, no implementation project. You can be writing your first itinerary today."
			icon="M4 10h12M10 4v12"
		/>
		<ol class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each start as step, index (step.t)}
				<li class="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_12px_36px_rgba(50,58,70,0.05)]">
					<span class="flex size-9 items-center justify-center rounded-xl bg-brand-500 text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(28,132,238,0.25)]">{index + 1}</span>
					<h3 class="mt-4 text-[15.5px] font-semibold text-slate-900">{step.t}</h3>
					<p class="mt-1.5 text-[13.5px] leading-6 text-slate-500">{step.d}</p>
				</li>
			{/each}
		</ol>
		<div class="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
			<a href={getStartedHref} class="btn-primary min-h-12 !rounded-lg !px-6 text-[15px]">Create your account</a>
			<a href="/login" class="btn-secondary min-h-12 !rounded-lg !px-6 text-[15px]">I already have one</a>
		</div>
	</div>
</section>

{#if data.plans.length}
	<section id="pricing" class="scroll-mt-24 border-b border-slate-100 bg-white">
		<div class="mx-auto max-w-[1240px] px-4 py-[70px] sm:px-6 sm:py-[90px] lg:px-10">
			<SectionHead
				label="Pricing"
				title="Start on a trial. Pay when it is running your season."
				subtitle="Every plan includes a 14-day free trial and no card up front."
				icon="M2 6h16v8H2V6Zm0 3h16"
			/>
			<div class="mt-12 grid gap-4 sm:grid-cols-2 {columns}">{#each data.plans as plan (plan.code)}<article class="relative flex flex-col rounded-2xl border bg-white p-6 {plan.code === recommended ? 'border-brand-300 shadow-[0_24px_60px_rgba(28,132,238,0.12)] ring-1 ring-brand-200' : 'border-slate-200 shadow-[0_15px_40px_rgba(50,58,70,0.05)]'}">{#if plan.code === recommended}<span class="absolute -top-3 left-5 rounded-full bg-brand-500 px-3 py-1 text-[10px] font-bold text-white shadow-sm">Recommended</span>{/if}<h3 class="text-base font-semibold text-slate-900">{plan.name}</h3><p class="mt-3 text-3xl font-bold tracking-tight text-slate-900">{price(plan)}{#if plan.priceMonthly > 0}<span class="text-[12.5px] font-normal text-slate-400"> / month</span>{/if}</p><p class="mt-3 text-[12.5px] leading-5 text-slate-500">A workspace with the capabilities included in this plan.</p><ul class="mt-6 flex-1 space-y-2">{#each plan.highlights as highlight (highlight)}{@render check(highlight)}{/each}</ul><a href={getStartedHref} class="mt-7 min-h-11 !rounded-lg {plan.code === recommended ? 'btn-primary' : 'btn-secondary'}">Get Started</a></article>{/each}</div>
		</div>
	</section>
{/if}

<section id="developers" class="scroll-mt-24 border-b border-slate-100 bg-[#faf8f5]">
	<div class="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-[70px] sm:px-6 sm:py-[90px] lg:grid-cols-2 lg:px-10">
		<div>
			<SectionHead
				align="left"
				label="Developers"
				title="Already have a website? Point it at Connect."
				subtitle="Your existing site can keep its own enquiry form and send submissions straight into the same inbox as the marketplace ones. REST API, API keys and webhooks for the events you care about."
				icon="M5 3h7l3 3v11H5V3Zm7 0v3h3"
			/>
			<div class="mt-6 flex flex-wrap gap-2">{#each ['REST API', 'API keys and scopes', 'Webhooks', 'Idempotent writes', 'Documentation'] as item}<span class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-slate-600">{item}</span>{/each}</div>
			<a href="/documentation" class="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:underline">Explore documentation <span aria-hidden="true">→</span></a>
		</div>
		<!-- min-w-0: a grid item defaults to min-width:auto, so the widest line of the
		     code block would stretch the whole track past the viewport on a phone
		     instead of letting the <pre> scroll inside itself. -->
		<div class="min-w-0">
			<div class="overflow-hidden rounded-2xl border border-white/10 bg-[#1f1a15] shadow-[0_28px_70px_rgba(16,27,43,0.24)]"><div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3"><span class="truncate font-mono text-[11.5px] text-slate-400">POST /api/v1/booking-requests</span><span class="rounded bg-success/15 px-2 py-0.5 font-mono text-[10px] text-[#8fd7ab]">201</span></div><pre class="overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-slate-300"><code><span>{'{'}</span>
  <span>"customer": {'{'}</span>
    <span>"firstName": "Asha",</span>
    <span>"whatsappPhone": "+255754000128"</span>
  <span>{'}'},</span>
  <span>"adults": 2,</span>
  <span>"items": [</span>
    <span>{'{'} "type": "TOUR", "title": "4-Day Serengeti" {'}'}</span>
  <span>]</span>
<span>{'}'}</span></code></pre></div>
			<div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold text-slate-500"><span class="rounded-lg border border-slate-200 bg-white px-3 py-2">Your website</span><span aria-hidden="true">→</span><span class="rounded-lg bg-slate-900 px-3 py-2 text-white">API</span><span aria-hidden="true">→</span><span class="rounded-lg bg-brand-500 px-3 py-2 text-white">Connect inbox</span></div>
		</div>
	</div>
</section>

<section class="border-b border-slate-100 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-[70px] sm:px-6 sm:py-[90px] lg:px-10"><SectionHead
			align="left"
			label="Security &amp; control"
			title="Traveller money and traveller data deserve serious controls."
			icon="M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z"
		/><div class="mt-10 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{#each [{ t: 'Your business is its own boundary', d: 'Every operator works inside a server-scoped data boundary. An enquiry can only ever reach the operator who owns the tour.' }, { t: 'Granular permissions', d: 'Roles limit what each member of your team can open, change and send.' }, { t: 'Secure WhatsApp credentials', d: 'Your WhatsApp tokens stay encrypted and server-side. They never reach a browser.' }, { t: 'Webhook verification', d: 'Inbound provider events are authenticated before anything is processed.' }, { t: 'Auditable payments', d: 'Requests, traveller reports and verification actions each keep their own audit record.' }, { t: 'Unpublished stays unpublished', d: 'A listing in draft or in review is invisible to the public marketplace — including to your competitors.' }] as item (item.t)}<div class="flex gap-3"><span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z" /><path d="m7.5 10 2 2 3.5-4" /></svg></span><div><h3 class="text-[14.5px] font-semibold text-slate-800">{item.t}</h3><p class="mt-1 text-[12.5px] leading-5 text-slate-500">{item.d}</p></div></div>{/each}</div></div>
</section>

<section class="bg-[#2b231b] text-white">
	<div class="mx-auto max-w-[1240px] px-4 py-[70px] text-center sm:px-6 sm:py-[90px] lg:px-10"><p class="text-[11.5px] font-bold tracking-[0.18em] text-blue-200 uppercase">Start selling</p><h2 class="mx-auto mt-4 max-w-5xl text-[32px] leading-tight font-bold tracking-[-0.04em] text-white sm:text-4xl lg:text-5xl">Put your journeys in front of travellers.<br class="hidden lg:block" /> Run the rest from here.</h2><p class="mx-auto mt-5 max-w-xl text-sm leading-7 text-blue-100/75">List on Makutano Journeys, answer on your own WhatsApp, and take the trip from enquiry to departure in one place.</p><div class="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center"><a href={getStartedHref} class="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-[#2b231b] transition hover:bg-blue-50">Create your account</a><a href="https://journeys.makutano.co.tz" target="_blank" rel="noopener" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition hover:bg-white/10">See the marketplace <svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg></a></div><p class="mt-5 text-[12.5px] text-blue-200/70">14-day free trial · No card required</p></div>
</section>
