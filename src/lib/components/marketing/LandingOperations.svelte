<script lang="ts">
	/*
	 * Enquiry → WhatsApp → quotation → booking → payment.
	 *
	 * Two claims are deliberately narrower than they look:
	 *  - quotations cannot be edited or revised in code, so the copy says "send a
	 *    new one from the same enquiry" rather than "revise and resend";
	 *  - Connect never touches money. It records what was paid. Saying otherwise
	 *    would be a claim the software cannot enforce.
	 */
	let { signupEnabled }: { signupEnabled: boolean } = $props();

	const before = ['A message on someone’s personal phone', 'Details in a notebook or a spreadsheet', 'The quotation in a different app', 'Nobody else can see any of it'];
	const after = ['The traveller writes on WhatsApp', 'It lands in your shared Connect inbox', 'The enquiry knows which tour and which dates', 'The quotation is priced from it', 'Acceptance becomes the booking'];
</script>

<section id="product" class="border-y border-slate-200 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">

		<!-- §5 the first enquiry -->
		<div class="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
			<div>
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">The first enquiry</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-[34px]">
					Someone is interested. What happens now?
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					Instead of a message you have to decode later, the enquiry arrives knowing who sent it,
					which tour they were reading and when they want to travel. It stays attached to that
					customer for the rest of the journey.
				</p>
			</div>

			<div class="rounded-panel border border-brand-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
				<div class="flex items-center gap-2">
					<span class="size-2 rounded-full bg-brand-500"></span>
					<p class="text-[11px] font-bold tracking-[0.14em] text-brand-600 uppercase">New enquiry</p>
				</div>
				<p class="mt-3 text-[17px] font-bold text-slate-900">Sarah M.</p>
				<p class="text-[13.5px] text-slate-500">2 travellers</p>
				<div class="mt-3 rounded-lg bg-canvas px-3 py-2.5">
					<p class="text-[14px] font-semibold text-slate-800">5 Day Serengeti &amp; Ngorongoro Safari</p>
					<p class="mt-0.5 text-[13px] text-slate-500">Travel date: 18 October</p>
				</div>
				<span class="mt-4 inline-flex min-h-10 items-center rounded-lg bg-brand-600 px-4 text-[13.5px] font-semibold text-white">Open enquiry</span>
			</div>
		</div>

		<!-- §6 WhatsApp: a channel, not the product -->
		<div class="mt-16 border-t border-slate-200 pt-14 lg:mt-20 lg:pt-16">
			<div class="max-w-2xl">
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">WhatsApp</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-[34px]">
					Bring your WhatsApp conversations into the same workflow.
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					Connect your own business WhatsApp number. Messages still come from you — customers see
					your number, not a platform's. What changes is that your team can see the conversation,
					and it sits next to the enquiry it belongs to.
				</p>
			</div>

			<div class="mt-8 grid gap-4 lg:grid-cols-2">
				<div class="rounded-panel border border-slate-200 bg-canvas p-5">
					<p class="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">Before</p>
					<ul class="mt-3 space-y-2">
						{#each before as line (line)}
							<li class="flex gap-2.5 text-[13.5px] leading-6 text-slate-500">
								<span class="mt-2 size-1.5 shrink-0 rounded-full bg-slate-300"></span>{line}
							</li>
						{/each}
					</ul>
				</div>
				<div class="rounded-panel border border-brand-200 bg-brand-50/40 p-5">
					<p class="text-[11px] font-bold tracking-[0.14em] text-brand-600 uppercase">With Connect</p>
					<ul class="mt-3 space-y-2">
						{#each after as line (line)}
							<li class="flex gap-2.5 text-[13.5px] leading-6 text-slate-700">
								<span class="mt-2 size-1.5 shrink-0 rounded-full bg-brand-400"></span>{line}
							</li>
						{/each}
					</ul>
				</div>
			</div>
			<div class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
				<!-- The real connection route. It has an unauthenticated branch, so a
				     visitor who is not signed in still lands somewhere sensible. -->
				<a href="/connect/whatsapp" class="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50">
					Connect WhatsApp
				</a>
				<p class="text-[12.5px] text-slate-500">You keep your number. You can add it whenever you're ready — it isn't needed to start.</p>
			</div>
		</div>

		<!-- §9 quotations, §10 booking, §11 payment -->
		<div class="mt-16 border-t border-slate-200 pt-14 lg:mt-20 lg:pt-16">
			<div class="max-w-2xl">
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Quotation &amp; booking</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-[34px]">
					The traveller is interested. Send the offer.
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					Build the quotation from the enquiry, so the customer, the tour and the dates are already
					there. Send it, and the traveller opens it on their own link.
				</p>
			</div>

			<ol class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				{#each [{ t: 'Prepare', d: 'Priced from the enquiry.' }, { t: 'Send', d: 'By email and WhatsApp.' }, { t: 'They review', d: 'On their own link.' }, { t: 'Want changes?', d: 'Send a new quotation from the same enquiry.' }, { t: 'They accept', d: 'It becomes a booking.' }] as s, i (s.t)}
					<li class="rounded-panel border border-slate-200 bg-canvas p-4">
						<p class="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">Step {i + 1}</p>
						<p class="mt-1.5 text-[15px] font-semibold text-slate-900">{s.t}</p>
						<p class="mt-1 text-[13px] leading-6 text-slate-500">{s.d}</p>
					</li>
				{/each}
			</ol>

			<div class="mt-8 grid gap-4 lg:grid-cols-2">
				<div class="rounded-panel border border-slate-200 bg-canvas p-5">
					<h3 class="text-[18px] font-bold tracking-[-0.01em] text-slate-900">When they accept, it becomes a booking.</h3>
					<p class="mt-2 text-[14px] leading-7 text-slate-600">
						Connect now knows who is travelling, what they booked, what was agreed and what happens
						next — without anyone rebuilding it from old WhatsApp messages.
					</p>
				</div>
				<div class="rounded-panel border border-slate-200 bg-canvas p-5">
					<h3 class="text-[18px] font-bold tracking-[-0.01em] text-slate-900">Keep payment progress with the booking.</h3>
					<p class="mt-2 text-[14px] leading-7 text-slate-600">
						Record deposits and balances as they arrive, so anyone looking at the booking can see
						what has been paid and what is still outstanding.
					</p>
					<p class="mt-3 text-[13px] leading-6 text-slate-500">
						Customers pay you the way they already do — mobile money, bank transfer or cash.
						Connect keeps the record, it doesn't take the money.
					</p>
				</div>
			</div>
		</div>
	</div>
</section>
