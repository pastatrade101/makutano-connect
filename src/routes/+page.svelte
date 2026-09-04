<script lang="ts">
	/*
	 * The public product site.
	 *
	 * It is written as a guided explanation rather than a feature list, because the
	 * reader is a tour operator who has never heard of Makutano and whose real
	 * question is "what would I actually do first?".
	 *
	 * Two rules held throughout, both from docs/PRODUCT.md: no claim the software
	 * cannot enforce, and no jargon an operator would not already use. Anything the
	 * code does not do is either absent or described honestly — store badges appear
	 * only once the URLs are configured, quotations are re-sent rather than
	 * "revised", payment is recorded rather than taken, and the loop closes at the
	 * verified review because reputation-driven ranking is not built.
	 */
	import BrandLockup from '$lib/components/BrandLockup.svelte';
	import LandingHero from '$lib/components/marketing/LandingHero.svelte';
	import LandingEcosystem from '$lib/components/marketing/LandingEcosystem.svelte';
	import LandingStart from '$lib/components/marketing/LandingStart.svelte';
	import LandingOperations from '$lib/components/marketing/LandingOperations.svelte';
	import LandingTrip from '$lib/components/marketing/LandingTrip.svelte';
	import LandingReviews from '$lib/components/marketing/LandingReviews.svelte';
	import LandingTeamApps from '$lib/components/marketing/LandingTeamApps.svelte';
	import LandingPaths from '$lib/components/marketing/LandingPaths.svelte';
	import LandingFaq from '$lib/components/marketing/LandingFaq.svelte';
	import LandingFinal from '$lib/components/marketing/LandingFinal.svelte';

	let { data } = $props();
	const getStartedHref = $derived(data.signupEnabled ? '/signup' : '/login');
	const hasApps = $derived(Boolean(data.appStoreUrl || data.playStoreUrl));
	let menuOpen = $state(false);

	const nav = $derived([
		{ href: '/#loop', label: 'How it works' },
		{ href: '/#start', label: 'Getting started' },
		{ href: '/#product', label: 'What you get' }
	]);
</script>

<svelte:head>
	<title>Makutano Connect — Run your tour business from one place</title>
	<meta
		name="description"
		content="Makutano Connect keeps a tour operator's enquiries, WhatsApp conversations, quotations, bookings, trips, team and vehicles together — from the first traveller enquiry to the final day of the trip."
	/>
</svelte:head>

<div class="marketing overflow-x-clip bg-white text-slate-700">
	<header class="sticky top-0 z-50 border-b border-slate-200/70 bg-white/88 backdrop-blur-xl">
		<nav class="mx-auto flex h-[70px] max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-10">
			<BrandLockup />
			<div class="hidden items-center gap-7 md:flex">
				{#each nav as item (item.href)}
					<a href={item.href} class="text-[14.5px] font-medium text-slate-500 transition hover:text-slate-900">{item.label}</a>
				{/each}
			</div>
			<div class="hidden items-center gap-2 md:flex">
				<a href="/login" class="btn-secondary !rounded-lg !px-4 !py-2 text-[14.5px]">Sign in</a>
				<a href={getStartedHref} class="btn-primary !rounded-lg !px-4 !py-2 text-[14.5px] shadow-[0_8px_20px_rgba(180,83,42,0.20)]">
					{data.signupEnabled ? 'Get started' : 'Sign in'}
				</a>
			</div>
			<button class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onclick={() => (menuOpen = !menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
				{#if menuOpen}<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg>{:else}<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>{/if}
			</button>
		</nav>
		{#if menuOpen}
			<div class="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
				{#each nav as item (item.href)}<a href={item.href} class="block border-b border-slate-100 py-3 text-sm font-medium text-slate-600" onclick={() => (menuOpen = false)}>{item.label}</a>{/each}
				<div class="mt-3 grid grid-cols-2 gap-2"><a href="/login" class="btn-secondary !rounded-lg" onclick={() => (menuOpen = false)}>Sign in</a><a href={getStartedHref} class="btn-primary !rounded-lg" onclick={() => (menuOpen = false)}>Get started</a></div>
			</div>
		{/if}
	</header>

	<main>
		<LandingHero {getStartedHref} signupEnabled={data.signupEnabled} {hasApps} />
		<LandingEcosystem marketplaceUrl={data.marketplaceUrl} />
		<LandingStart {getStartedHref} signupEnabled={data.signupEnabled} marketplaceUrl={data.marketplaceUrl} />
		<LandingOperations signupEnabled={data.signupEnabled} />
		<LandingTrip />
		<LandingReviews marketplaceUrl={data.marketplaceUrl} />
		<LandingTeamApps appStoreUrl={data.appStoreUrl} playStoreUrl={data.playStoreUrl} signupEnabled={data.signupEnabled} />
		<LandingPaths
			{getStartedHref}
			signupEnabled={data.signupEnabled}
			marketplaceUrl={data.marketplaceUrl}
			appStoreUrl={data.appStoreUrl}
			playStoreUrl={data.playStoreUrl}
		/>
		<LandingFaq marketplaceUrl={data.marketplaceUrl} {hasApps} />
		<LandingFinal
			{getStartedHref}
			signupEnabled={data.signupEnabled}
			marketplaceUrl={data.marketplaceUrl}
			trialDays={data.trialDays}
			{hasApps}
		/>
	</main>

	<footer class="border-t border-slate-200 bg-white pb-20 md:pb-0">
		<div class="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-10">
			<div>
				<BrandLockup size="sm" />
				<p class="mt-3 max-w-sm text-[12.5px] leading-5 text-slate-400">Where tour operators sell their journeys and run the trips they sell.</p>
			</div>
			<div class="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-slate-500">
				<a href={data.marketplaceUrl} target="_blank" rel="noopener">Makutano Journeys</a>
				<a href="/#start">Getting started</a>
				<a href="/#product">What you get</a>
				<a href="/documentation">Documentation</a>
				<a href="/legal/terms">Terms</a>
				<a href="/legal/privacy">Privacy</a>
				<a href="mailto:connect@makutano.co.tz">Contact</a>
			</div>
			<p class="text-[11.5px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</p>
		</div>
	</footer>

	<!--
		Mobile sticky bar. The page is long by design, and on a phone the primary
		action would otherwise be a scroll away at every point in the middle.
	-->
	<div class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-xl md:hidden">
		<div class="flex gap-2">
			<a href="/login" class="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg border border-slate-200 text-[14px] font-semibold text-slate-700">Sign in</a>
			<a href={getStartedHref} class="inline-flex min-h-12 flex-[1.4] items-center justify-center rounded-lg bg-brand-600 text-[14px] font-semibold text-white">
				{data.signupEnabled ? 'Start your tour business' : 'Open Connect'}
			</a>
		</div>
	</div>
</div>

<style>
	@media (prefers-reduced-motion: reduce) {
		:global(.marketing *) { scroll-behavior: auto !important; animation: none !important; transition-duration: 0.01ms !important; }
	}
</style>
