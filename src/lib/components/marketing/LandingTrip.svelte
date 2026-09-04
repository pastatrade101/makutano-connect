<script lang="ts">
	/*
	 * Where Connect stops being a sales tool and becomes an operations one.
	 *
	 * Tracking is described in plain language and kept clearly optional: no
	 * provider name, no device identifiers, no protocol. The security warning is
	 * the real one shown in the product, not a softened version of it.
	 */
	const stages = [
		{ t: 'Booking confirmed', d: 'The traveller has accepted.' },
		{ t: 'Prepare the trip', d: 'Connect shows what is still missing.' },
		{ t: 'Assign the team', d: 'Driver, guide, whoever else is going.' },
		{ t: 'Assign a vehicle', d: 'From the vehicles you operate.' },
		{ t: 'The trip runs', d: 'Everyone knows what was agreed.' },
		{ t: 'Trip completed', d: 'And the traveller can be asked for a review.' }
	];
</script>

<section class="bg-canvas">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="max-w-2xl">
			<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Operations</p>
			<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
				A booking isn't the finish. It's where the work begins.
			</h2>
			<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
				Most systems stop once the money is agreed. The trip still has to be staffed, crewed and
				driven — and that is the part that decides whether the traveller writes a good review.
			</p>
		</div>

		<ol class="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each stages as s, i (s.t)}
				<li class="rounded-panel border border-slate-200 bg-white p-5">
					<span class="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">Stage {i + 1}</span>
					<p class="mt-1.5 text-[16px] font-semibold text-slate-900">{s.t}</p>
					<p class="mt-1 text-[13.5px] leading-6 text-slate-500">{s.d}</p>
				</li>
			{/each}
		</ol>

		<!-- §13 vehicles, deliberately optional -->
		<div class="mt-14 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
			<div>
				<h3 class="text-[22px] font-bold tracking-[-0.02em] text-slate-900">Add the vehicles your business operates.</h3>
				<p class="mt-3 max-w-xl text-[14.5px] leading-7 text-slate-600">
					Register a vehicle once, then put it on the trips it runs. The trip shows which vehicle is
					assigned, and the vehicle shows which trip it is on.
				</p>
				<p class="mt-3 max-w-xl rounded-panel bg-slate-100/70 px-4 py-3 text-[13.5px] leading-6 text-slate-600">
					Vehicle management is there when your operation needs it. You can run enquiries, quotations,
					bookings and trips without setting up a fleet at all.
				</p>
			</div>
			<div class="rounded-panel border border-slate-200 bg-white p-5">
				<p class="text-[15.5px] font-semibold text-slate-900">Toyota Land Cruiser</p>
				<p class="mt-0.5 font-mono text-[13px] text-slate-500">AJZ-399 · T989 EAT</p>
				<span class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[12px] font-semibold text-success ring-1 ring-success/20">
					<span class="size-1.5 rounded-full bg-success"></span> Available
				</span>
			</div>
		</div>

		<!-- §14 tracking, optional and plainly described -->
		<div class="mt-12 rounded-panel border border-slate-200 bg-white p-6 lg:p-8">
			<div class="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-start">
				<div>
					<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Optional</p>
					<h3 class="mt-2 text-[22px] font-bold tracking-[-0.02em] text-slate-900">
						Know where an assigned vehicle is during a trip.
					</h3>
					<p class="mt-3 text-[14.5px] leading-7 text-slate-600">
						For the vehicles that need it, Connect can show the latest reported location and the
						route it has taken. There is no hardware to buy — a driver's phone can do it.
					</p>
					<p class="mt-3 text-[13.5px] leading-6 text-slate-500">
						Plenty of operators never turn this on, and everything else works exactly the same.
					</p>
				</div>
				<div>
					<ol class="space-y-2.5">
						{#each ['Open the vehicle and choose GPS tracking', 'Pick the driver’s phone', 'Connect shows a private setup code', 'The driver scans it with the tracking app', 'The vehicle appears on your map'] as line, i (line)}
							<li class="flex gap-3 text-[13.5px] leading-6 text-slate-600">
								<span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
								{line}
							</li>
						{/each}
					</ol>
					<p class="mt-4 rounded-panel bg-warning/5 px-4 py-3 text-[12.5px] leading-6 text-warning">
						Keep the setup code private. Anyone with access to it may be able to configure another
						tracking phone for that vehicle.
					</p>
				</div>
			</div>
		</div>

		<!-- §15 everything together -->
		<div class="mt-14">
			<h3 class="text-[22px] font-bold tracking-[-0.02em] text-slate-900">See the trip, not just the booking.</h3>
			<p class="mt-3 max-w-2xl text-[14.5px] leading-7 text-slate-600">
				Everything from earlier on this page, on one screen, for one real departure.
			</p>
			<div class="mt-6 overflow-hidden rounded-panel border border-slate-200 bg-white">
				<div class="border-b border-slate-100 bg-canvas px-5 py-4">
					<p class="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">Trip</p>
					<p class="mt-1 text-[17px] font-bold text-slate-900">4 Day Northern Circuit Highlights Safari</p>
				</div>
				<dl class="grid grid-cols-2 divide-slate-100 sm:grid-cols-3 lg:grid-cols-6">
					{#each [{ k: 'Traveller', v: 'Sarah + 1 guest' }, { k: 'Vehicle', v: 'Land Cruiser · T989 EAT' }, { k: 'Tracking', v: 'Recently updated' }, { k: 'Team', v: 'Driver and guide assigned' }, { k: 'Booking', v: 'Confirmed' }, { k: 'Payment', v: 'Deposit received' }] as cell (cell.k)}
						<div class="border-t border-slate-100 px-5 py-4 sm:border-r">
							<dt class="text-[11px] font-bold tracking-[0.12em] text-slate-400 uppercase">{cell.k}</dt>
							<dd class="mt-1 text-[13.5px] leading-6 font-medium text-slate-800">{cell.v}</dd>
						</div>
					{/each}
				</dl>
			</div>
		</div>
	</div>
</section>
