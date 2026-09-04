<script lang="ts">
	// Reback vertical shell: grouped sidenav (GENERAL / SALES / PLATFORM) with a
	// collapse toggle persisted per browser, white topbar with global search, the
	// notification bell, and an avatar menu; toast stack lives here too.
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toasts from '$components/Toasts.svelte';
	import { moduleRelevant, type Module } from '$lib/workspace';
	import { theme, toggleTheme } from '$lib/stores/theme.svelte';
	let { data, children } = $props();

	/** Whole days left on the trial, or null when the end date is unknown. */
	const trialDaysLeft = $derived.by(() => {
		const endsAt = data.trial?.endsAt;
		if (!endsAt) return null;
		return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
	});

	type Item = {
		href: string;
		label: string;
		icon: string;
		permission: string | null;
		primary?: boolean;
		/** Which workspace module this belongs to — resolved by $lib/workspace. */
		module?: Module;
		/** Entitlement that must be on, or the item renders locked. */
		entitlement?: string;
	};
	/*
	 * Grouped by what the operator is doing, not by what the software calls it.
	 *
	 * Nineteen flat entries is a list you hunt through rather than navigate. The
	 * headings are the job — selling a trip, running it, being found — so somebody
	 * looking for Quotations looks under Sales instead of scanning the whole thing.
	 *
	 * Every item keeps its own permission, module and entitlement gate: the groups
	 * are presentation, and a group with nothing visible in it disappears entirely.
	 * Orders is not in the sketch because it only exists for ORDERS workspaces;
	 * it sits in Sales, where it belongs when it is there at all.
	 */
	/*
	 * One accent per group, taken from the existing palette rather than invented,
	 * so both themes already define them. It is a wayfinding mark, not decoration:
	 * the dot and the rule carry the grouping, the item labels stay neutral, and
	 * the only strong colour in the list remains the page you are on.
	 */
	const GROUPS: Array<{ label: string; items: Item[]; footer?: boolean; accent?: string }> = [
		{
			label: '',
			items: [
				{ href: '/app', label: 'Home', icon: 'M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1v-6.5Z', permission: null, primary: true },
				{ href: '/app/conversations', label: 'Inbox', icon: 'M3 4h14v9H7l-4 3V4Z', permission: 'conversations:read', primary: true }
			]
		},
		{
			label: 'Sales',
			accent: 'bg-brand-500',
			items: [
				{ href: '/app/customers', label: 'Travellers', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0H4Z', permission: 'customers:read' },
				{ href: '/app/booking-requests', label: 'Enquiries', icon: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Z', permission: 'booking_requests:read', primary: true, module: 'enquiries' },
				{ href: '/app/quotations', label: 'Quotations', icon: 'M5 3h7l3 3v11H5V3Zm7 0v3h3', permission: 'quotations:read', module: 'quotations', entitlement: 'quotations.enabled' },
				{ href: '/app/bookings', label: 'Bookings', icon: 'M3 5h14v12H3V5Zm2 3h10v2H5V8Z', permission: 'bookings:read', module: 'bookings' },
				{ href: '/app/orders', label: 'Orders', icon: 'M5 4h10l1.5 3v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7L5 4Zm-1 3h12M8 10a2 2 0 0 0 4 0', permission: 'orders:read', primary: true, module: 'orders', entitlement: 'orders.enabled' },
				{ href: '/app/payments', label: 'Payments', icon: 'M2 6h16v8H2V6Zm0 3h16', permission: 'payments:read' }
			]
		},
		{
			label: 'Operations',
			accent: 'bg-success',
			items: [
				{ href: '/app/trips', label: 'Trips', icon: 'M2 12h16M6 12V7l3-3 3 3v5M4 12v4h12v-4', permission: 'trips:read', module: 'trips' },
				{ href: '/app/vehicles', label: 'Vehicles', icon: 'M3 13h14v3H3v-3Zm1-3 1.5-3.5A1 1 0 0 1 6.4 6h7.2a1 1 0 0 1 .9.5L16 10M5.5 16v1M14.5 16v1', permission: 'vehicles:read', module: 'trips' },
				{ href: '/app/tracking', label: 'Live map', icon: 'M10 2a5 5 0 0 0-5 5c0 3.5 5 11 5 11s5-7.5 5-11a5 5 0 0 0-5-5Zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z', permission: 'vehicles:read', module: 'trips' }
			]
		},
		{
			label: 'Marketplace',
			accent: 'bg-info',
			items: [
				{ href: '/app/tours', label: 'Tours', icon: 'M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.4 4.5 10 4.5 10s4.5-6.6 4.5-10A4.5 4.5 0 0 0 10 2.5Zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z', permission: 'tours:read', module: 'bookings' },
				{ href: '/app/reviews', label: 'Reviews', icon: 'm10 2.6 2.3 4.7 5.2.7-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.5 8l5.2-.7L10 2.6Z', permission: 'reviews:read', module: 'bookings' }
			]
		},
		{
			label: 'Growth',
			accent: 'bg-purple',
			items: [
				{ href: '/app/leads', label: 'Leads', icon: 'M3 16 8 9l3 3 6-8', permission: 'leads:read', module: 'leads' },
				{ href: '/app/forms', label: 'Forms & widgets', icon: 'M4 4h12v3H4V4Zm0 5h12v3H4V9Zm0 5h7v3H4v-3Z', permission: 'forms:read', entitlement: 'forms.hostedEnabled' }
			]
		},
		{
			label: 'Tools',
			accent: 'bg-slate-400',
			items: [
				{ href: '/app/whatsapp/templates', label: 'Templates', icon: 'M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2Z', permission: 'whatsapp:read', entitlement: 'whatsapp.enabled' },
				{ href: '/app/developers', label: 'Integrations', icon: 'M7 5 3 10l4 5m6-10 4 5-4 5', permission: 'api_keys:read', entitlement: 'api.enabled' }
			]
		},
		{
			// Sits below a rule, away from the daily work.
			label: '',
			footer: true,
			items: [
				{ href: '/app/settings', label: 'Settings', icon: 'M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', permission: 'tenant:read' }
			]
		}
	];

	const allowed = (item: Item) => {
		if (item.permission && !data.permissions?.includes(item.permission as never)) return false;
		// Relevance, not authorization: the module simply is not part of this business's
		// world. Entitlements and server-side checks still gate everything reachable.
		if (item.module && !moduleRelevant(data.tenant.capabilities, item.module)) return false;
		return true;
	};
	/** Locked = visible but not navigable, so the tenant can see what a plan adds. */
	const locked = (item: Item) => !!item.entitlement && data.entitlements?.[item.entitlement] !== true;
	// No per-item relabelling any more: the one entry that renamed itself per
	// business type was the catalog, and it is gone.
	const groups = $derived(GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length));
	const flat = $derived(groups.flatMap((g) => g.items));
	const primary = $derived(flat.filter((n) => n.primary).slice(0, 3));
	const current = $derived(flat.find((n) => isActive(n.href))?.label ?? 'Overview');
	const inConversations = $derived(page.url.pathname.startsWith('/app/conversations'));
	const inConversationThread = $derived(/^\/app\/conversations\/[^/]+/.test(page.url.pathname));

	/** Global "+ New" (§6): only what this tenant can create, one tap from anywhere. */
	type QuickItem = { href: string; label: string; hint: string };
	const quickCreate = $derived.by(() => {
		const items: QuickItem[] = [];
		const ws = data.tenant.capabilities;
		const can = (perm: string) => data.permissions?.includes(perm as never);
		const ent = (key: string) => data.entitlements?.[key] === true;
		// Workspace relevance AND entitlement AND permission — the §9 triple, in order.
		if (moduleRelevant(ws, 'orders') && ent('orders.enabled') && can('orders:write')) {
			items.push({ href: '/app/orders/new', label: 'New order', hint: 'Record a customer order' });
			items.push({ href: '/app/orders/links', label: 'Order link', hint: 'One offer, one link to share' });
			items.push({ href: '/app/orders/batches?new=1', label: 'New batch', hint: 'A selling round with shared price' });
		}
		if (moduleRelevant(ws, 'enquiries') && can('booking_requests:write')) {
			items.push({ href: '/app/booking-requests/new', label: 'New enquiry', hint: ws === 'SERVICE' ? 'Log a customer enquiry' : 'Log a booking enquiry' });
		}
		if (can('customers:write')) {
		}
		// Quotations are deliberately absent: one always starts from an enquiry, so a
		// "New quotation" button could only ever drop someone on a list.
		return items;
	});
	let quickOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let mobileSearchOpen = $state(false);

	let collapsed = $state(browser ? localStorage.getItem('mk-nav-collapsed') === '1' : false);
	let userMenu = $state(false);
	let search = $state('');

	function toggleNav() {
		collapsed = !collapsed;
		if (browser) localStorage.setItem('mk-nav-collapsed', collapsed ? '1' : '0');
	}

	// All nav hrefs, longest first — used to pick the most specific match so a parent
	// route (WhatsApp) does not light up while a child route (Templates) is open.
	const allHrefs = GROUPS.flatMap((g) => g.items.map((i) => i.href)).sort((a, b) => b.length - a.length);

	function isActive(href: string): boolean {
		if (href === '/app') return page.url.pathname === '/app';
		const best = allHrefs.find((h) => h !== '/app' && (page.url.pathname === h || page.url.pathname.startsWith(`${h}/`)));
		return best === href;
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		const q = search.trim();
		mobileSearchOpen = false;
		void goto(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search');
	}

	function openQuickCreate() {
		mobileMenuOpen = false;
		quickOpen = !quickOpen;
	}

	function openMobileMenu() {
		quickOpen = false;
		mobileMenuOpen = !mobileMenuOpen;
	}

	/*
	 * Which groups are folded, remembered per browser.
	 *
	 * Open is the default: a nav that hides things on first look is worse than a
	 * long one. Folding is for the operator who never touches Growth, and it
	 * should still be folded tomorrow — but a group containing the page you are
	 * on is always shown, so the sidebar can never hide where you are.
	 */
	let folded = $state<string[]>([]);
	const isOpen = (g: { label: string; items: Item[]; footer?: boolean; accent?: string }) =>
		!g.label || !folded.includes(g.label) || g.items.some((i) => isActive(i.href));

	function toggleGroup(label: string) {
		folded = folded.includes(label) ? folded.filter((l) => l !== label) : [...folded, label];
		try {
			localStorage.setItem('mk-nav-folded', JSON.stringify(folded));
		} catch {
			// Private windows and blocked site data throw here. Folding still works
			// for this visit; it just will not be remembered.
		}
	}

	$effect(() => {
		try {
			const raw = localStorage.getItem('mk-nav-folded');
			if (raw) folded = JSON.parse(raw) as string[];
		} catch {
			folded = [];
		}
	});
</script>

<Toasts />

<div class="flex min-h-screen bg-canvas {theme.dark ? 'mk-dark' : ''}">
	<!-- Sidenav (desktop) -->
	<aside class="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200 bg-white lg:flex {collapsed ? 'w-[70px]' : 'w-60'} transition-[width] duration-200">
		<div class="flex h-[70px] items-center gap-2.5 border-b border-slate-200 {collapsed ? 'justify-center px-2' : 'px-5'}">
			<img src="/2.png" alt="" class="size-8 shrink-0 object-contain" />
			{#if !collapsed}
				<div class="min-w-0">
					<div class="truncate text-[16.5px] font-bold tracking-tight text-slate-800">Makutano</div>
					<div class="-mt-0.5 text-[11.5px] font-semibold tracking-widest text-brand-500 uppercase">Connect</div>
				</div>
			{/if}
		</div>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			{#each groups as group (group.label + group.items[0].href)}
				{#if group.footer}
					<div class="mx-1 mt-4 mb-3 border-t-2 border-slate-200"></div>
				{:else if !collapsed && group.label}
					<!-- A real rule between groups, not just space: the eye needs an edge
					     to count sections by. The heading is also the toggle — a group you
					     never use folds away and stays folded, and the one you are
					     standing in cannot, so the sidebar can never hide where you are. -->
					<div class="mx-1 mt-4 mb-1 border-t border-slate-200/70 first:mt-0 first:border-0"></div>
					<button
						onclick={() => toggleGroup(group.label)}
						aria-expanded={isOpen(group)}
						class="flex w-full items-center gap-2 rounded-panel px-2.5 pt-1.5 pb-2 text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase transition hover:text-slate-600"
					>
						<span class="size-1.5 shrink-0 rounded-full {group.accent ?? 'bg-slate-300'}"></span>
						<span class="flex-1 text-left">{group.label}</span>
						<svg
							class="size-3 shrink-0 transition-transform {isOpen(group) ? '' : '-rotate-90'}"
							viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"
						><path d="m4 6 4 4 4-4" /></svg>
					</button>
				{:else if collapsed}
					<!-- On the narrow rail the labels are gone, so the accent becomes the
					     separator — it is the only thing left that tells the groups apart. -->
					<div class="mx-3 my-3 h-0.5 rounded-full {group.accent ?? 'bg-slate-200'} opacity-50 first:hidden"></div>
				{/if}
				<div class="space-y-0.5 {isOpen(group) ? '' : 'hidden'}">
					{#each group.items as item (item.href)}
						{#if locked(item)}
							<div
								title="{item.label} is not included in your {data.planName} plan"
								class="flex cursor-not-allowed items-center gap-3 rounded-panel py-2 text-[15px] text-slate-300 {collapsed ? 'justify-center px-0' : 'px-2.5'}"
							>
								<svg class="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
								{#if !collapsed}
									<span class="flex-1">{item.label}</span>
									<svg class="size-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a4 4 0 0 0-4 4v2H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm-2 6V6a2 2 0 1 1 4 0v2H8Z" /></svg>
								{/if}
							</div>
						{:else}
							<a
								href={item.href}
								title={collapsed ? item.label : undefined}
								class="flex items-center gap-3 rounded-panel py-2 text-[15px] transition {collapsed ? 'justify-center px-0' : 'px-2.5'} {isActive(item.href)
									? 'bg-brand-50 font-semibold text-brand-600'
									: 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}"
							>
								<svg class="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
								{#if !collapsed}{item.label}{/if}
							</a>
						{/if}
					{/each}
				</div>
			{/each}
		</nav>

		{#if data.user.isSuperAdmin && !collapsed}
			<div class="border-t border-slate-200 p-3">
				<a href="/admin" class="block rounded-panel px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700">Super admin →</a>
			</div>
		{/if}
	</aside>

	<!-- A thread is a fixed frame on every screen: the message list scrolls, the header
	     and composer do not. Desktop used to fall back to page height, which pushed the
	     composer below the fold once a thread carried context strips. -->
	<div class="flex min-w-0 flex-1 flex-col {inConversationThread ? 'h-dvh overflow-hidden pb-0' : 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'} lg:pb-0 {collapsed ? 'lg:pl-[70px]' : 'lg:pl-60'} transition-[padding] duration-200">
		<!-- Topbar -->
		<header class="sticky top-0 z-20 {inConversationThread ? 'hidden' : 'flex'} h-14 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-3 backdrop-blur lg:flex lg:h-[70px] lg:bg-white lg:px-6">
			<div class="flex min-w-0 items-center gap-3">
				<button class="hidden rounded-panel p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:block" onclick={toggleNav} aria-label="Toggle navigation">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
				</button>
				<img src="/2.png" alt="" class="size-7 shrink-0 object-contain lg:hidden" />

				<form onsubmit={submitSearch} class="relative hidden md:block">
					<input bind:value={search} placeholder="Search travellers, enquiries, references…" class="w-64 rounded-panel border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-[14.5px] placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500" />
					<svg class="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" /></svg>
				</form>
				<div class="min-w-0 md:hidden">
					<p class="truncate text-[10px] font-bold tracking-[0.14em] text-brand-500 uppercase">Makutano Connect</p>
					<h2 class="-mt-0.5 truncate text-[15px] leading-5 font-semibold text-slate-800">{current}</h2>
				</div>
			</div>

			<div class="flex items-center gap-1.5">
				<button
					class="rounded-full p-2 text-slate-500 hover:bg-slate-100 md:hidden"
					onclick={() => (mobileSearchOpen = true)}
					aria-label="Search"
				>
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg>
				</button>
				{#if quickCreate.length}
					<div class="relative hidden lg:block">
						<button class="btn-primary !py-1.5 text-[14.5px]" onclick={() => (quickOpen = !quickOpen)} aria-label="Create new">
							<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4v12M4 10h12" /></svg>
							<span class="hidden sm:inline">New</span>
						</button>
						{#if quickOpen}
							<button class="fixed inset-0 z-20 hidden cursor-default lg:block" onclick={() => (quickOpen = false)} aria-label="Close menu" tabindex="-1"></button>
							<div class="absolute right-0 z-30 mt-1 hidden w-60 rounded-panel border border-slate-200 bg-white py-1 shadow-md lg:block">
								{#each quickCreate as item (item.href)}
									<a href={item.href} class="block px-3 py-2 hover:bg-slate-50" onclick={() => (quickOpen = false)}>
										<div class="text-[14.5px] font-medium text-slate-700">{item.label}</div>
										<div class="text-[12.5px] text-slate-400">{item.hint}</div>
									</a>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<button
					class="hidden rounded-panel p-2 text-slate-500 hover:bg-slate-100 lg:block"
					onclick={toggleTheme}
					aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
					title={theme.dark ? 'Light mode' : 'Dark mode'}
				>
					{#if theme.dark}
						<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="3.5" /><path d="M10 2.5v2m0 11v2m7.5-7.5h-2m-11 0h-2m12.8-5.3-1.4 1.4M6.1 13.9l-1.4 1.4m10.6 0-1.4-1.4M6.1 6.1 4.7 4.7" /></svg>
					{:else}
						<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16.5 11.5A6.5 6.5 0 0 1 8.5 3.5a6.5 6.5 0 1 0 8 8Z" /></svg>
					{/if}
				</button>
				<a href="/app/conversations" class="relative hidden rounded-panel p-2 text-slate-500 hover:bg-slate-100 lg:block" aria-label="Inbox notifications">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4-1.5 4.8-.2.3 0 .7.4.7h11.2c.4 0 .6-.4.4-.7-.5-.8-1.5-1.8-1.5-4.8A4.5 4.5 0 0 0 10 3Zm-1.7 10.8a1.8 1.8 0 0 0 3.4 0" /></svg>
					{#if data.unreadCount > 0}
						<span class="absolute -top-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full bg-danger text-[11.5px] font-bold text-white">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>
					{/if}
				</a>

				<div class="relative hidden lg:block">
					<button class="flex items-center gap-2 rounded-panel p-1.5 hover:bg-slate-100" onclick={() => (userMenu = !userMenu)} aria-label="Account menu">
						<div class="flex size-8 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">
							{(data.user.fullName || data.user.email).slice(0, 1).toUpperCase()}
						</div>
						<div class="hidden text-left lg:block">
							<div class="text-[14.5px] leading-4 font-semibold text-slate-700">{data.user.fullName || data.user.email.split('@')[0]}</div>
							<div class="text-[12.5px] leading-4 text-slate-400 capitalize">{data.role?.replace(/_/g, ' ').toLowerCase()}</div>
						</div>
					</button>
					{#if userMenu}
						<div class="absolute right-0 z-30 mt-1 w-48 rounded-panel border border-slate-200 bg-white py-1 shadow-md">
							<div class="border-b border-slate-100 px-3 py-2">
								<div class="truncate text-[14.5px] font-semibold text-slate-700">{data.tenant.name}</div>
								<div class="truncate text-[12.5px] text-slate-400">{data.user.email}</div>
							</div>
							{#if data.user.isSuperAdmin}
								<a href="/admin" class="block px-3 py-2 text-[14.5px] text-slate-600 hover:bg-slate-50">Super admin</a>
							{/if}
							<a href="/app/settings" class="block px-3 py-2 text-[14.5px] text-slate-600 hover:bg-slate-50">Settings</a>
							<form method="POST" action="/logout">
								<button type="submit" class="w-full px-3 py-2 text-left text-[14.5px] text-danger hover:bg-danger/5">Sign out</button>
							</form>
						</div>
					{/if}
				</div>
			</div>
		</header>

		<main class="mx-auto flex w-full min-w-0 max-w-[1600px] flex-1 flex-col {inConversations ? 'min-h-0 p-0' : 'p-3 sm:p-4'} lg:p-6">
			{#if !inConversationThread}
				{#if data.tenantSuspended}
					<div class="mb-4 rounded-panel bg-danger/10 px-4 py-3 text-sm text-danger">
						<b>This account is suspended.</b> You can still view your data, but new orders, bookings, messages and API writes are blocked. Please contact support.
					</div>
				{:else if data.trial}
					<div class="mb-3 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2.5 text-xs text-brand-800 sm:mb-4 sm:rounded-panel sm:px-4">
						<span>
							{#if trialDaysLeft === null}
								You're on a free trial — everything is switched on.
							{:else if trialDaysLeft > 1}
								<span class="sm:hidden"><b>{trialDaysLeft} days</b> left in your free trial.</span>
								<span class="hidden sm:inline"><b>{trialDaysLeft} days</b> left on your free trial. Nothing is charged until you choose a plan.</span>
							{:else if trialDaysLeft === 1}
								Your free trial ends <b>tomorrow</b>.
							{:else}
								Your free trial ends <b>today</b>.
							{/if}
						</span>
						<a href="/app/settings" class="shrink-0 font-semibold underline">Manage plan</a>
					</div>
				{:else if data.nearLimits?.length}
					<div class="mb-4 rounded-panel bg-warning/10 px-4 py-2.5 text-xs text-[#b58514]">
						You're approaching your monthly limit —
						{#each data.nearLimits as l, i (l.label)}{i > 0 ? ', ' : ' '}<b>{l.label.toLowerCase()} {l.used}/{l.limit}</b>{/each}.
						<a href="/app/settings" class="font-semibold underline">View usage</a>
					</div>
				{/if}
			{/if}
			{@render children()}
			<footer class="mt-8 hidden text-center text-[12.5px] text-slate-400 lg:block">{new Date().getFullYear()} © Makutano Connect</footer>
		</main>
	</div>

	<!-- Mobile bottom tabs: daily work stays one tap away; every other module lives in More. -->
	{#if !inConversationThread}
	<nav class="mobile-tabbar fixed inset-x-0 bottom-0 z-30 grid border-t border-slate-200/80 bg-white/95 px-1 backdrop-blur lg:hidden" style="grid-template-columns: repeat({primary.length + (quickCreate.length ? 2 : 1)}, 1fr)">
		{#each primary.slice(0, 2) as item (item.href)}
			<a href={item.href} class="relative flex min-w-0 flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] {isActive(item.href) ? 'font-semibold text-brand-500' : 'text-slate-400'}">
				<span class="relative">
					<svg class="size-[21px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d={item.icon} /></svg>
					{#if item.href === '/app/conversations' && data.unreadCount > 0}
						<span class="absolute -top-1.5 -right-2 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] leading-4 font-bold text-white">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>
					{/if}
				</span>
				{item.label}
			</a>
		{/each}
		{#if quickCreate.length}
			<button class="flex min-w-0 flex-col items-center gap-0.5 px-1 pt-1 pb-1.5 text-[11px] text-slate-500" onclick={openQuickCreate} aria-label="Create new">
				<span class="flex size-8 items-center justify-center rounded-full bg-brand-500 text-white shadow-sm shadow-brand-500/25">
					<svg class="size-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4v12M4 10h12" /></svg>
				</span>
				New
			</button>
		{/if}
		{#each primary.slice(2) as item (item.href)}
			<a href={item.href} class="flex min-w-0 flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] {isActive(item.href) ? 'font-semibold text-brand-500' : 'text-slate-400'}">
				<svg class="size-[21px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d={item.icon} /></svg>
				{item.label}
			</a>
		{/each}
		<button class="flex min-w-0 flex-col items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] {mobileMenuOpen ? 'font-semibold text-brand-500' : 'text-slate-400'}" onclick={openMobileMenu} aria-label="Open all sections">
			<svg class="size-[21px]" viewBox="0 0 20 20" fill="currentColor"><circle cx="5" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" /><circle cx="5" cy="15" r="1.5" /><circle cx="15" cy="15" r="1.5" /></svg>
			More
		</button>
	</nav>
	{/if}

	<!-- Mobile search, deliberately full-width so filters and results never compete with the keyboard. -->
	{#if mobileSearchOpen}
		<div class="fixed inset-0 z-50 bg-white lg:hidden">
			<div class="flex h-14 items-center gap-2 border-b border-slate-200 px-3">
				<button class="rounded-full p-2 text-slate-500" onclick={() => (mobileSearchOpen = false)} aria-label="Close search">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12.5 4.5-5 5 5 5" /></svg>
				</button>
				<form onsubmit={submitSearch} class="relative flex-1">
					<input bind:value={search} placeholder="Search travellers, enquiries, references…" class="input h-10 rounded-full bg-slate-50 pl-10" />
					<svg class="pointer-events-none absolute top-3 left-3.5 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" /></svg>
				</form>
			</div>
			<p class="px-5 pt-5 text-sm text-slate-500">Search across customers, conversations, bookings, orders and references.</p>
		</div>
	{/if}

	<!-- Mobile create sheet -->
	{#if quickOpen}
		<div class="fixed inset-0 z-40 flex items-end bg-slate-900/40 lg:hidden">
			<button class="absolute inset-0 cursor-default" onclick={() => (quickOpen = false)} aria-label="Close" tabindex="-1"></button>
			<div class="mobile-sheet relative z-10 w-full rounded-t-3xl bg-white p-4 shadow-lg">
				<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200"></div>
				<p class="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Create</p>
				<div class="space-y-1">
					{#each quickCreate as item (item.href)}
						<a href={item.href} class="block rounded-panel px-3 py-3 hover:bg-slate-50 active:bg-slate-100" onclick={() => (quickOpen = false)}>
							<div class="text-sm font-medium text-slate-700">{item.label}</div>
							<div class="text-[12.5px] text-slate-400">{item.hint}</div>
						</a>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- Every permitted destination remains available on mobile without crowding the tab bar. -->
	{#if mobileMenuOpen}
		<div class="fixed inset-0 z-40 flex items-end bg-slate-900/40 lg:hidden">
			<button class="absolute inset-0 cursor-default" onclick={() => (mobileMenuOpen = false)} aria-label="Close menu" tabindex="-1"></button>
			<div class="mobile-sheet relative z-10 max-h-[82dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-xl">
				<div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold text-slate-800">{data.tenant.name}</p>
						<p class="truncate text-[12px] text-slate-400">{data.user.fullName || data.user.email} · {data.role?.replace(/_/g, ' ').toLowerCase()}</p>
					</div>
					<button class="rounded-full bg-slate-50 p-2 text-slate-500" onclick={() => (mobileMenuOpen = false)} aria-label="Close menu">
						<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg>
					</button>
				</div>

				<div class="space-y-5 p-4">
					{#each groups as group (group.label)}
						<section>
							<!-- Same accent and rule as the sidebar, so the grouping reads the
							     same on a phone as it does on a laptop. -->
							{#if group.label}
								<h3 class="mb-2 flex items-center gap-2 border-t border-slate-200/70 px-1 pt-3 text-[11px] font-bold tracking-[0.14em] text-slate-400 uppercase">
									<span class="size-1.5 shrink-0 rounded-full {group.accent ?? 'bg-slate-300'}"></span>
									{group.label}
								</h3>
							{:else if group.footer}
								<div class="mb-2 border-t-2 border-slate-200"></div>
							{/if}
							<div class="grid grid-cols-2 gap-2">
								{#each group.items as item (item.href)}
									{#if locked(item)}
										<div class="flex min-h-12 cursor-not-allowed items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-slate-300">
											<svg class="size-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
											<span class="min-w-0 flex-1 truncate text-sm">{item.label}</span>
											<svg class="size-3 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a4 4 0 0 0-4 4v2H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm-2 6V6a2 2 0 1 1 4 0v2H8Z" /></svg>
										</div>
									{:else}
										<a href={item.href} class="flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 {isActive(item.href) ? 'bg-brand-50 font-semibold text-brand-600' : 'bg-slate-50 text-slate-600'}" onclick={() => (mobileMenuOpen = false)}>
											<svg class="size-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
											<span class="min-w-0 truncate text-sm">{item.label}</span>
										</a>
									{/if}
								{/each}
							</div>
						</section>
					{/each}
				</div>

				<div class="sticky bottom-0 grid grid-cols-3 gap-2 border-t border-slate-100 bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
					<button class="btn-secondary" onclick={toggleTheme}>{theme.dark ? 'Light mode' : 'Dark mode'}</button>
					{#if data.user.isSuperAdmin}<a href="/admin" class="btn-secondary" onclick={() => (mobileMenuOpen = false)}>Admin</a>{:else}<a href="/app/settings" class="btn-secondary" onclick={() => (mobileMenuOpen = false)}>Settings</a>{/if}
					<form method="POST" action="/logout"><button type="submit" class="btn-danger w-full">Sign out</button></form>
				</div>
			</div>
		</div>
	{/if}
</div>
