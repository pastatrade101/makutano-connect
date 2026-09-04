<script lang="ts">
	let {
		getStartedHref,
		signupEnabled,
		marketplaceUrl,
		trialDays,
		hasApps
	}: {
		getStartedHref: string;
		signupEnabled: boolean;
		marketplaceUrl: string;
		trialDays: number;
		hasApps: boolean;
	} = $props();
</script>

<section class="bg-[#2b231b]">
	<div class="mx-auto max-w-[1240px] px-4 py-16 text-center sm:px-6 lg:px-10 lg:py-24">
		<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-200 uppercase">From the first enquiry to the road</p>
		<h2 class="mx-auto mt-4 max-w-3xl text-[30px] leading-tight font-bold tracking-[-0.035em] text-white text-balance sm:text-4xl lg:text-5xl">
			Bring your tours, customers, conversations, bookings and operations into one workspace.
		</h2>
		<p class="mx-auto mt-5 max-w-xl text-[15px] leading-7 text-white/70">
			Start with your company. We'll show you what comes next.
		</p>

		<div class="mt-9 flex flex-col gap-3 sm:flex-row sm:justify-center">
			<a href={getStartedHref} class="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-6 text-sm font-semibold text-[#2b231b] transition hover:bg-brand-50">
				{signupEnabled ? 'Create my Makutano Connect account' : 'Sign in to Connect'}
			</a>
			{#if signupEnabled}
				<a href="/login" class="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition hover:bg-white/10">Sign in</a>
			{/if}
			<a href={marketplaceUrl} target="_blank" rel="noopener" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 px-6 text-sm font-semibold text-white transition hover:bg-white/10">
				I'm a traveller
				<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M7 13 13 7m0 0H8m5 0v5" /></svg>
			</a>
		</div>

		<p class="mt-6 text-[12.5px] text-white/50">
			{#if trialDays > 0}{trialDays}-day free trial · {/if}Works on the web{#if hasApps}, iPhone and Android{/if}
		</p>
	</div>
</section>
