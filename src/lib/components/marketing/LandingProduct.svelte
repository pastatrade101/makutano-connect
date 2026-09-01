<script lang="ts">
	import SectionHead from './SectionHead.svelte';

	// The whole pitch in six steps. `where` is the load-bearing field: an operator
	// arriving cold has to learn there are TWO products and which half each step
	// happens in, and a coloured pill teaches that faster than another paragraph.
	const loop = [
		{
			where: 'journeys',
			t: 'A traveller finds your tour',
			d: 'Your listing sits on the public marketplace with its day-by-day itinerary, destinations, photos and price.'
		},
		{
			where: 'journeys',
			t: 'They enquire',
			d: 'Dates, party size and their question go to the operator who actually runs the trip — you.'
		},
		{
			where: 'connect',
			t: 'It lands in your inbox',
			d: 'As an ordinary enquiry in Connect, with the traveller and the tour they asked about already attached.'
		},
		{
			where: 'connect',
			t: 'You reply on WhatsApp',
			d: 'On your own WhatsApp Business number. Your team sees the thread; the traveller only ever sees you.'
		},
		{
			where: 'connect',
			t: 'Quotation, then booking',
			d: 'Quote straight from the enquiry. Accepting it creates the booking — nothing retyped, no numbers drifting.'
		},
		{
			where: 'connect',
			t: 'Payment, then the trip runs',
			d: 'Request the deposit, verify what arrived, and hand the confirmed booking to operations with its dates and crew.'
		}
	];

	// The itinerary mock: real fields off a tour listing, not decoration.
	const itinerary = [
		{ day: 'Day 1', title: 'Arusha to Tarangire', stay: 'Tarangire Safari Lodge', meals: 'L, D' },
		{ day: 'Day 2', title: 'Serengeti central plains', stay: 'Seronera Camp', meals: 'B, L, D' },
		{ day: 'Day 3', title: 'Ngorongoro Crater floor', stay: 'Rhino Lodge', meals: 'B, L, D' }
	];

	// Everything else that is genuinely built, kept to one line each.
	const capabilities = [
		{ t: 'Enquiries and quotations', d: 'Every enquiry keeps its traveller, its tour and its conversation. Quote from it and accept to convert.', icon: 'M5 3h7l3 3v11H5V3Zm7 0v3h3' },
		{ t: 'Bookings and payments', d: 'References, line items, payment requests and verified payments — with an audit record for each step.', icon: 'M2 6h16v8H2V6Zm0 3h16' },
		{ t: 'Departures and crew', d: 'A trip is the operational half of a booking: dates, readiness and the driver or guide running it.', icon: 'M2 12h16M6 12V7l3-3 3 3v5M4 12v4h12v-4' },
		{ t: 'Travellers and leads', d: 'One record per traveller, their whole history, and a pipeline for the enquiries still being won.', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0H4Z' },
		{ t: 'A mobile app for the field', d: 'The same permissions and the same data as the browser, in the hands of whoever is out on the trip.', icon: 'M6 2h8v16H6V2Zm3 14h2' },
		{ t: 'Roles and permissions', d: 'Managers, agents and finance see the work that is theirs. Verifying a payment is its own permission.', icon: 'M10 2 4 4.5v5c0 3.7 2.6 6.6 6 8 3.4-1.4 6-4.3 6-8v-5L10 2Z' }
	];
</script>

{#snippet check(text: string)}
	<li class="flex items-start gap-2.5 text-[14.5px] leading-6 text-slate-600"><span class="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600"><svg class="size-2.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m4 10.5 4 4 8-9" /></svg></span><span>{text}</span></li>
{/snippet}

<section id="loop" class="scroll-mt-24 border-b border-slate-100 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-[70px] sm:px-6 sm:py-[90px] lg:px-10">
		<SectionHead
			label="How it works"
			title="From a traveller's first click to a departure you actually run."
			subtitle="Journeys brings you the traveller. Connect is where the sale and the trip happen. This is the whole loop."
			icon="M4 10h12M10 4v12"
		/>

		<!-- A rail on a phone, a grid on a desktop. The steps are a SEQUENCE, so the
		     narrow layout is the one that has to work first: numbers down the left with
		     a line joining them, and nothing that shrinks into unreadability. -->
		<ol class="mt-10 lg:grid lg:grid-cols-3 lg:gap-4">
			{#each loop as step, index (step.t)}
				<li class="relative flex gap-4 pb-7 last:pb-0 lg:block lg:rounded-2xl lg:border lg:border-slate-200 lg:bg-white lg:p-5 lg:pb-5 lg:shadow-[0_12px_36px_rgba(50,58,70,0.05)]">
					{#if index < loop.length - 1}
						<span class="absolute top-11 bottom-0 left-[19.5px] w-px bg-slate-200 lg:hidden" aria-hidden="true"></span>
					{/if}
					<span
						class="relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full text-[14.5px] font-bold {step.where ===
						'journeys'
							? 'bg-brand-500 text-white shadow-[0_8px_18px_rgba(28,132,238,0.28)]'
							: 'bg-[#2b231b] text-white shadow-[0_8px_18px_rgba(14,51,93,0.25)]'}">{index + 1}</span
					>
					<div class="min-w-0 lg:mt-4">
						<span
							class="inline-flex rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-[0.06em] uppercase {step.where ===
							'journeys'
								? 'bg-brand-50 text-brand-600'
								: 'bg-slate-100 text-slate-600'}"
						>
							{step.where === 'journeys' ? 'On Journeys' : 'In Connect'}
						</span>
						<h3 class="mt-2 text-[17px] leading-6 font-semibold text-slate-900">{step.t}</h3>
						<p class="mt-1.5 text-[14.5px] leading-[1.55] text-slate-500">{step.d}</p>
					</div>
				</li>
			{/each}
		</ol>

		<p class="mt-8 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-5 py-4 text-center text-[13.5px] leading-6 font-medium text-brand-700">
			You never share a platform phone number. The traveller messages your business, on your number,
			from the first reply to the last trip update.
		</p>
	</div>
</section>

<section id="product" class="scroll-mt-24 border-b border-slate-100 bg-[#faf8f5]">
	<div class="mx-auto max-w-[1240px] px-4 py-[70px] sm:px-6 sm:py-[90px] lg:px-10">
		<SectionHead
			label="What you get"
			title="A marketplace listing at the front. A working business behind it."
			subtitle="Everything here is built and running today — no waitlists, no coming-soon tiles."
			icon="M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v11l-3-1.8L10 16l-3-1.8L4 16V5Z"
		/>

		<div class="mt-12 grid items-center gap-10 lg:mt-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16">
			<div>
				<p class="flex items-center gap-2"><span class="flex size-[30px] items-center justify-center rounded-md bg-brand-500 text-[12.5px] font-bold text-white">01</span><span class="h-px w-6 border-t border-dashed border-brand-400"></span><span class="rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-brand-600">Tour listings</span></p>
				<h3 class="feature-title">Write the journey the way you actually sell it.</h3>
				<p class="feature-copy">A listing is not a product row with a price. It is a day-by-day itinerary — where they sleep, what they eat, how far they drive — and Connect gives you a field for each of them.</p>
				<ul class="mt-6 grid gap-x-5 gap-y-1 sm:grid-cols-2 lg:grid-cols-1">{@render check('Day-by-day itinerary with destinations')}{@render check('Highlights, what is included and what is not')}{@render check('Duration, group size, travel style, season')}{@render check('Per-person, per-group or “from” pricing')}{@render check('Photos and video hosted on Cloudflare R2')}{@render check('Your own operator profile on the marketplace')}</ul>
			</div>
			<div class="rounded-2xl bg-brand-500 p-2 shadow-[0_24px_65px_rgba(50,58,70,0.12)]">
				<div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div><div class="text-[13.5px] font-semibold text-slate-800">4-Day Serengeti &amp; Ngorongoro</div><div class="text-[10px] text-slate-400">Tanzania · Small group · From TZS 1,700,000 per person</div></div><span class="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold text-success">Published</span></div>
					<div class="p-4 sm:p-5">
						<p class="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Itinerary</p>
						<ol class="mt-3 space-y-2">
							{#each itinerary as day (day.day)}
								<li class="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"><span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-[10px] font-bold text-brand-600 ring-1 ring-slate-200">{day.day.replace('Day ', '')}</span><div class="min-w-0"><div class="text-[11.5px] font-semibold text-slate-700">{day.title}</div><div class="mt-0.5 truncate text-[10px] text-slate-400">{day.stay} · Meals {day.meals}</div></div></li>
							{/each}
							<li class="rounded-xl border border-dashed border-slate-300 p-3 text-center text-[10px] font-medium text-slate-400">Day 4 · Crater rim to Arusha</li>
						</ol>
						<div class="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">{#each ['Park fees included', 'Max 6 guests', 'Year-round'] as tag}<span class="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-600">{tag}</span>{/each}</div>
					</div>
				</div>
			</div>
		</div>

		<div class="mt-20 grid items-center gap-10 lg:mt-24 lg:grid-cols-[1.18fr_0.82fr] lg:gap-16">
			<div class="order-2 lg:order-1 rounded-2xl bg-brand-500 p-2 shadow-[0_24px_65px_rgba(50,58,70,0.12)]">
				<div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
					<div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3"><div><div class="text-[13.5px] font-semibold text-slate-800">Asha M.</div><div class="text-[10px] text-slate-400">+255 754 000 128 · your WhatsApp Business number</div></div><span class="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-semibold text-brand-600">Assigned to Robert</span></div>
					<div class="grid min-h-[300px] sm:grid-cols-[155px_1fr]"><div class="hidden border-r border-slate-200 bg-slate-50/70 p-3 sm:block"><p class="text-[9px] font-bold text-slate-400 uppercase">Conversations</p><div class="mt-3 rounded-lg bg-white p-2.5 shadow-sm"><div class="text-[11.5px] font-semibold text-slate-700">Asha M.</div><div class="mt-1 truncate text-[10px] text-slate-400">Is the 4-day Serengeti…</div></div><div class="mt-2 rounded-lg p-2.5 text-[10px] text-slate-400">Mariam K.</div><div class="mt-1 rounded-lg p-2.5 text-[10px] text-slate-400">Tom &amp; Lisa B.</div></div><div class="p-4 sm:p-5"><div class="max-w-[85%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2.5 text-[12.5px] leading-5 text-slate-700">Is the 4-day Serengeti still open for two people in September?</div><div class="mt-5 flex flex-wrap gap-2"><span class="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">● Robert is typing…</span><span class="rounded-full bg-purple/10 px-2.5 py-1 text-[10px] font-medium text-purple">Neema is viewing</span></div><div class="mt-7 flex flex-wrap gap-2"><span class="rounded-lg bg-brand-500 px-3 py-2 text-[11.5px] font-semibold text-white">Take conversation</span><span class="rounded-lg border border-slate-200 px-3 py-2 text-[11.5px] font-semibold text-slate-600">Assign</span></div><div class="mt-6 border-t border-slate-100 pt-4"><p class="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Visibility</p><div class="mt-2 flex flex-wrap gap-2"><span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">Assigned team only</span><span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">History retained</span></div></div></div></div>
				</div>
			</div>
			<div class="order-1 lg:order-2">
				<p class="flex items-center gap-2"><span class="flex size-[30px] items-center justify-center rounded-md bg-brand-500 text-[12.5px] font-bold text-white">02</span><span class="h-px w-6 border-t border-dashed border-brand-400"></span><span class="rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-brand-600">Your own WhatsApp</span></p>
				<h3 class="feature-title">Your number. Your team. One thread per traveller.</h3>
				<p class="feature-copy">Connect your own WhatsApp Business number, then let the whole office work it without handing anyone the phone. Assignment, presence and permissions make ownership visible.</p>
				<ul class="mt-5 space-y-1">{@render check('Your business number, never a shared platform one')}{@render check('Shared inbox with assignment and live presence')}{@render check('Assigned-only and private conversations')}{@render check('Approved template messages for updates')}</ul>
			</div>
		</div>

		<div class="mt-20 overflow-hidden rounded-[24px] border border-brand-200 bg-[#2b231b] text-white shadow-[0_35px_90px_rgba(14,51,93,0.20)] lg:mt-24">
			<div class="grid items-center gap-10 p-6 sm:p-9 lg:grid-cols-[0.8fr_1.2fr] lg:p-12">
				<div><span class="text-[11.5px] font-bold tracking-[0.17em] text-blue-200 uppercase">03 · Payments</span><h3 class="mt-4 text-3xl leading-tight font-bold tracking-[-0.035em] text-white">A deposit request that doesn’t end in a dead end.</h3><p class="mt-4 text-sm leading-7 text-blue-100/75">Tell the traveller how to pay, capture their report, have a person verify it, update the booking and notify them — without pretending a button proves the money arrived.</p></div>
				<div class="rounded-2xl border border-white/15 bg-white p-5 text-slate-700 shadow-2xl"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Deposit requested</p><p class="mt-1 text-2xl font-bold text-slate-900">TZS 1,020,000</p><p class="mt-1 text-[11.5px] text-slate-400">M-Pesa · GFA-BK-2026-00128</p></div><span class="rounded-full bg-warning/10 px-2.5 py-1 text-[10px] font-semibold text-[#a9780c]">Awaiting verification</span></div><div class="mt-5 grid gap-2 sm:grid-cols-5">{#each [{ t: 'Requested', s: 'How to pay', c: 'done' }, { t: '“I have paid”', s: 'Traveller report', c: 'done' }, { t: 'Verify', s: 'Staff action', c: 'active' }, { t: 'Booking updated', s: 'Confirmed', c: 'later' }, { t: 'Traveller notified', s: 'WhatsApp', c: 'later' }] as item, index (item.t)}<div class="rounded-xl border p-3 {item.c === 'done' ? 'border-success/20 bg-success/5' : item.c === 'active' ? 'border-warning/30 bg-warning/5' : 'border-slate-200 bg-slate-50'}"><span class="text-[9px] font-bold {item.c === 'done' ? 'text-success' : item.c === 'active' ? 'text-[#a9780c]' : 'text-slate-300'}">0{index + 1}</span><div class="mt-5 text-[10px] font-semibold text-slate-700">{item.t}</div><div class="mt-0.5 text-[9px] text-slate-400">{item.s}</div></div>{/each}</div></div>
			</div>
		</div>

		<div class="mt-20 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:mt-24 lg:grid-cols-3">
			{#each capabilities as item (item.t)}
				<div class="flex gap-3">
					<span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d={item.icon} /></svg></span>
					<div><h3 class="text-[14.5px] font-semibold text-slate-800">{item.t}</h3><p class="mt-1 text-[12.5px] leading-5 text-slate-500">{item.d}</p></div>
				</div>
			{/each}
		</div>
	</div>
</section>
