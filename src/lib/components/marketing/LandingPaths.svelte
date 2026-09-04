<script lang="ts">
	/*
	 * Two jobs: lower the fear of starting, then route people to the right door.
	 *
	 * The "already using Connect" path exists to stop an employee registering a
	 * second company account, which would split their workspace in half.
	 */
	let {
		getStartedHref,
		signupEnabled,
		marketplaceUrl,
		appStoreUrl,
		playStoreUrl
	}: {
		getStartedHref: string;
		signupEnabled: boolean;
		marketplaceUrl: string;
		appStoreUrl: string;
		playStoreUrl: string;
	} = $props();

	const now = ['Create your account', 'Add your company', 'Add your first tour'];
	const later = ['Connect WhatsApp', 'Invite your team', 'Send quotations', 'Confirm bookings', 'Prepare trips', 'Register vehicles', 'Turn on vehicle tracking'];
</script>

<section class="border-y border-slate-200 bg-white">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="max-w-2xl">
			<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Take it in order</p>
			<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-4xl">
				You don't need to set up everything today.
			</h2>
			<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
				Start simple. Add the operational tools when your work actually needs them.
			</p>
		</div>

		<div class="mt-8 grid gap-4 lg:grid-cols-2">
			<div class="rounded-panel border border-brand-200 bg-brand-50/40 p-5">
				<p class="text-[11px] font-bold tracking-[0.14em] text-brand-600 uppercase">To get started</p>
				<ol class="mt-3 space-y-2">
					{#each now as item, i (item)}
						<li class="flex gap-3 text-[14px] leading-6 font-medium text-slate-800">
							<span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">{i + 1}</span>
							{item}
						</li>
					{/each}
				</ol>
			</div>
			<div class="rounded-panel border border-slate-200 bg-canvas p-5">
				<p class="text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">Whenever you're ready</p>
				<ul class="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
					{#each later as item (item)}
						<li class="flex gap-2.5 text-[13.5px] leading-6 text-slate-600">
							<span class="mt-2 size-1.5 shrink-0 rounded-full bg-slate-300"></span>{item}
						</li>
					{/each}
				</ul>
			</div>
		</div>

		<!-- Three doors -->
		<div class="mt-14">
			<h3 class="text-[22px] font-bold tracking-[-0.02em] text-slate-900">Where should I go?</h3>
			<div class="mt-6 grid gap-4 lg:grid-cols-3">
				<div class="flex flex-col rounded-panel border border-brand-300 bg-white p-5">
					<p class="text-[15.5px] font-bold text-slate-900">I run tours and I'm new to Makutano.</p>
					<p class="mt-2 flex-1 text-[13.5px] leading-6 text-slate-600">Create your company workspace and we'll walk you through the setup, one step at a time.</p>
					<a href={getStartedHref} class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 text-[13.5px] font-semibold text-white transition hover:bg-brand-700">
						{signupEnabled ? 'Create my operator account' : 'Sign in'}
					</a>
				</div>

				<div class="flex flex-col rounded-panel border border-slate-200 bg-white p-5">
					<p class="text-[15.5px] font-bold text-slate-900">My company already uses Connect.</p>
					<p class="mt-2 flex-1 text-[13.5px] leading-6 text-slate-600">
						Don't register again — a second account would split your workspace in two. Sign in, or ask
						a colleague to invite you.
					</p>
					<a href="/login" class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50">Sign in</a>
					{#if appStoreUrl || playStoreUrl}
						<div class="mt-2 flex flex-wrap gap-2">
							{#if appStoreUrl}<a href={appStoreUrl} target="_blank" rel="noopener" class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">App Store</a>{/if}
							{#if playStoreUrl}<a href={playStoreUrl} target="_blank" rel="noopener" class="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-slate-200 px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50">Google Play</a>{/if}
						</div>
					{/if}
				</div>

				<div class="flex flex-col rounded-panel border border-slate-200 bg-canvas p-5">
					<p class="text-[15.5px] font-bold text-slate-900">I'm a traveller looking for a trip.</p>
					<p class="mt-2 flex-1 text-[13.5px] leading-6 text-slate-600">You don't need an operator account. Browse tours and send an enquiry on Makutano Journeys.</p>
					<a href={marketplaceUrl} target="_blank" rel="noopener" class="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50">
						Explore Makutano Journeys
						<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
					</a>
				</div>
			</div>
		</div>
	</div>
</section>
