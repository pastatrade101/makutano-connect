<script lang="ts">
	// Admin shell at full parity with the portal: Reback dark-menu sidenav with a
	// persisted collapse toggle (overlay on mobile), topbar with tenant search, an
	// alerts bell fed by live error counts, and the avatar menu.
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toasts from '$components/Toasts.svelte';
	let { data, children } = $props();

	const NAV = [
		{ href: '/admin', label: 'System health', icon: 'M3 10h4l2-5 3 10 2-5h3' },
		{ href: '/admin/tenants', label: 'Tenants', icon: 'M3 17V7l4-3 4 3v10M11 17V9l3-2 3 2v8M3 17h14' },
		{ href: '/admin/plans', label: 'Plans & entitlements', icon: 'M3 6h14M3 10h14M3 14h9' },
		{ href: '/admin/usage', label: 'Usage & subscriptions', icon: 'M4 16V9m4 7V5m4 11v-4m4 4V8' },
		{ href: '/admin/whatsapp', label: 'WhatsApp connections', icon: 'M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2Z' },
		{ href: '/admin/errors', label: 'Delivery & payment errors', icon: 'M10 7v4m0 3h.01M4.2 17h11.6a1.5 1.5 0 0 0 1.3-2.2L11.3 4a1.5 1.5 0 0 0-2.6 0L2.9 14.8A1.5 1.5 0 0 0 4.2 17Z' },
		{ href: '/admin/audit', label: 'Audit logs', icon: 'M6 3h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 4h4M8 10h4m-4 3h2' }
	];

	const current = $derived(NAV.find((n) => isActive(n.href))?.label ?? 'Admin');
	const isActive = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href));

	let collapsed = $state(browser ? localStorage.getItem('mk-admin-nav-collapsed') === '1' : false);
	let mobileOpen = $state(false);
	let userMenu = $state(false);
	let search = $state('');

	function toggleNav() {
		if (browser && window.innerWidth < 1024) {
			mobileOpen = !mobileOpen;
			return;
		}
		collapsed = !collapsed;
		if (browser) localStorage.setItem('mk-admin-nav-collapsed', collapsed ? '1' : '0');
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const q = search.trim();
		void goto(`/admin/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`);
	}

	$effect(() => {
		void page.url.pathname;
		mobileOpen = false;
		userMenu = false;
	});
</script>

<Toasts />

{#if mobileOpen}
	<button class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onclick={() => (mobileOpen = false)} aria-label="Close navigation"></button>
{/if}

<div class="flex min-h-screen">
	<!-- Sidenav: fixed on desktop (collapsible), slide-over on mobile -->
	<aside
		class="fixed inset-y-0 left-0 z-40 flex-col bg-sidenav-dark transition-[width] duration-200
			{mobileOpen ? 'flex w-64' : 'hidden'}
			lg:flex {collapsed ? 'lg:w-[70px]' : 'lg:w-64'}"
	>
		<div class="flex h-[70px] items-center gap-2.5 border-b border-white/10 {collapsed && !mobileOpen ? 'lg:justify-center lg:px-2' : 'px-5'}">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
			{#if !collapsed || mobileOpen}
				<div class="min-w-0">
					<div class="truncate text-[15px] font-bold tracking-tight text-white">Makutano</div>
					<div class="-mt-0.5 text-[10px] font-semibold tracking-widest text-[#9097a7] uppercase">Platform admin</div>
				</div>
			{/if}
		</div>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			{#if !collapsed || mobileOpen}
				<p class="px-2.5 pb-2 text-[10px] font-bold tracking-widest text-[#5d6675] uppercase">Operations</p>
			{/if}
			<div class="space-y-0.5">
				{#each NAV as item (item.href)}
					<a
						href={item.href}
						title={collapsed && !mobileOpen ? item.label : undefined}
						class="flex items-center gap-3 rounded-panel py-2 text-[13.5px] transition {collapsed && !mobileOpen ? 'lg:justify-center lg:px-0 px-2.5' : 'px-2.5'} {isActive(item.href)
							? 'bg-white/10 font-semibold text-white'
							: 'text-[#9097a7] hover:bg-white/5 hover:text-white'}"
					>
						<svg class="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
						{#if !collapsed || mobileOpen}{item.label}{/if}
					</a>
				{/each}
			</div>
		</nav>

		{#if !collapsed || mobileOpen}
			<div class="border-t border-white/10 p-3 text-[11px]">
				<a href="/app" class="block rounded-panel px-2.5 py-1.5 text-[#9097a7] hover:bg-white/5 hover:text-white">← Tenant portal</a>
			</div>
		{/if}
	</aside>

	<div class="flex min-w-0 flex-1 flex-col {collapsed ? 'lg:pl-[70px]' : 'lg:pl-64'} transition-[padding] duration-200">
		<!-- Topbar -->
		<header class="sticky top-0 z-20 flex h-[60px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:h-[70px] lg:px-6">
			<div class="flex min-w-0 items-center gap-3">
				<button class="rounded-panel p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onclick={toggleNav} aria-label="Toggle navigation">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
				</button>

				<form onsubmit={submitSearch} class="relative hidden md:block">
					<input bind:value={search} placeholder="Search tenants…" class="w-64 rounded-panel border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-[13px] placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500" />
					<svg class="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" /></svg>
				</form>
				<h2 class="truncate text-[15px] font-semibold text-slate-800 md:hidden">{current}</h2>
			</div>

			<div class="flex items-center gap-1.5">
				<a href="/admin/errors" class="relative rounded-panel p-2 text-slate-500 hover:bg-slate-100" aria-label="Operational alerts">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4-1.5 4.8-.2.3 0 .7.4.7h11.2c.4 0 .6-.4.4-.7-.5-.8-1.5-1.8-1.5-4.8A4.5 4.5 0 0 0 10 3Zm-1.7 10.8a1.8 1.8 0 0 0 3.4 0" /></svg>
					{#if data.attention > 0}
						<span class="absolute -top-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">{data.attention > 9 ? '9+' : data.attention}</span>
					{/if}
				</a>

				<div class="relative">
					<button class="flex items-center gap-2 rounded-panel p-1.5 hover:bg-slate-100" onclick={() => (userMenu = !userMenu)} aria-label="Account menu">
						<div class="flex size-8 items-center justify-center rounded-full bg-sidenav-dark text-sm font-bold text-white">
							{(data.user.fullName || data.user.email).slice(0, 1).toUpperCase()}
						</div>
						<div class="hidden text-left lg:block">
							<div class="text-[13px] leading-4 font-semibold text-slate-700">{data.user.fullName || data.user.email.split('@')[0]}</div>
							<div class="text-[11px] leading-4 text-slate-400">Super admin</div>
						</div>
					</button>
					{#if userMenu}
						<div class="absolute right-0 z-30 mt-1 w-48 rounded-panel border border-slate-200 bg-white py-1 shadow-md">
							<div class="border-b border-slate-100 px-3 py-2">
								<div class="truncate text-[11px] text-slate-400">{data.user.email}</div>
							</div>
							<a href="/app" class="block px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">Tenant portal</a>
							<form method="POST" action="/logout">
								<button type="submit" class="w-full px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/5">Sign out</button>
							</form>
						</div>
					{/if}
				</div>
			</div>
		</header>

		<main class="min-w-0 flex-1 p-4 lg:p-6">
			{@render children()}
			<footer class="mt-8 text-center text-[11px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</footer>
		</main>
	</div>
</div>
