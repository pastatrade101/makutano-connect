<script lang="ts">
	import BrandLockup from '$lib/components/BrandLockup.svelte';
	import LandingHero from '$lib/components/marketing/LandingHero.svelte';
	import LandingProduct from '$lib/components/marketing/LandingProduct.svelte';
	import LandingLower from '$lib/components/marketing/LandingLower.svelte';

	let { data } = $props();
	const getStartedHref = $derived(data.signupEnabled ? '/signup' : '/login');
	let menuOpen = $state(false);
	const nav = $derived([
		{ href: '/#product', label: 'Product' },
		{ href: '/#how-it-works', label: 'How it Works' },
		{ href: '/#solutions', label: 'Solutions' },
		{ href: '/#developers', label: 'Developers' },
		...(data.plans.length ? [{ href: '/#pricing', label: 'Pricing' }] : [])
	]);
</script>

<svelte:head>
	<title>Makutano Connect — Customer operations infrastructure</title>
	<meta
		name="description"
		content="Connect WhatsApp, customer conversations, bookings, orders, payments and your team without rebuilding the systems your business already uses."
	/>
</svelte:head>

<div class="marketing overflow-x-clip bg-white text-slate-700">
	<header class="sticky top-0 z-50 border-b border-slate-200/70 bg-white/88 backdrop-blur-xl">
		<nav class="mx-auto flex h-[70px] max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-10">
			<BrandLockup />
			<div class="hidden items-center gap-7 md:flex">
				{#each nav as item (item.href)}
					<a href={item.href} class="text-[13px] font-medium text-slate-500 transition hover:text-slate-900">{item.label}</a>
				{/each}
			</div>
			<div class="hidden items-center gap-2 md:flex">
				<a href="/login" class="btn-secondary !rounded-lg !px-4 !py-2 text-[13px]">Sign In</a>
				<a href={getStartedHref} class="btn-primary !rounded-lg !px-4 !py-2 text-[13px] shadow-[0_8px_20px_rgba(28,132,238,0.18)]">Get Started</a>
			</div>
			<button class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden" onclick={() => (menuOpen = !menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
				{#if menuOpen}<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg>{:else}<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 5.5h14M3 10h14M3 14.5h14" /></svg>{/if}
			</button>
		</nav>
		{#if menuOpen}
			<div class="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
				{#each nav as item (item.href)}<a href={item.href} class="block border-b border-slate-100 py-3 text-sm font-medium text-slate-600" onclick={() => (menuOpen = false)}>{item.label}</a>{/each}
				<div class="mt-3 grid grid-cols-2 gap-2"><a href="/login" class="btn-secondary !rounded-lg" onclick={() => (menuOpen = false)}>Sign In</a><a href={getStartedHref} class="btn-primary !rounded-lg" onclick={() => (menuOpen = false)}>Get Started</a></div>
			</div>
		{/if}
	</header>

	<main>
		<LandingHero {getStartedHref} />
		<LandingProduct />
		<LandingLower {data} {getStartedHref} />
	</main>

	<footer class="border-t border-slate-200 bg-white">
		<div class="mx-auto flex max-w-[1240px] flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-10">
			<div><BrandLockup size="sm" /><p class="mt-3 max-w-sm text-[11px] leading-5 text-slate-400">The infrastructure behind modern customer journeys.</p></div>
			<div class="flex flex-wrap gap-x-6 gap-y-2 text-[11px] text-slate-500"><a href="/#product">Product</a><a href="/documentation">Documentation</a><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="mailto:connect@makutano.co.tz">Contact</a></div>
			<p class="text-[10px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</p>
		</div>
	</footer>
</div>

<style>
	:global(.marketing .eyebrow) { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-brand-600); }
	:global(.marketing .section-title) { margin-top: 0.7rem; font-size: clamp(2rem, 3.6vw, 2.8rem); line-height: 1.12; font-weight: 700; letter-spacing: -0.038em; color: var(--color-slate-900); }
	:global(.marketing .section-copy) { margin-top: 1rem; max-width: 42rem; font-size: 14px; line-height: 1.8; color: var(--color-slate-500); }
	:global(.marketing .feature-number) { font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--color-brand-600); }
	:global(.marketing .feature-title) { margin-top: 0.8rem; font-size: clamp(1.75rem, 3vw, 2.4rem); line-height: 1.16; font-weight: 700; letter-spacing: -0.035em; color: var(--color-slate-900); }
	:global(.marketing .feature-copy) { margin-top: 1rem; font-size: 14px; line-height: 1.8; color: var(--color-slate-500); }
	@media (prefers-reduced-motion: reduce) { :global(.marketing *) { scroll-behavior: auto !important; animation: none !important; transition-duration: 0.01ms !important; } }
</style>
