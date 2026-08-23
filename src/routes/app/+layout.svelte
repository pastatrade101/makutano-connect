<script lang="ts">
	// Reback vertical shell: grouped sidenav (GENERAL / SALES / PLATFORM) with a
	// collapse toggle persisted per browser, white topbar with global search, the
	// notification bell, and an avatar menu; toast stack lives here too.
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Toasts from '$components/Toasts.svelte';
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
		capability?: 'BOOKINGS' | 'ORDERS';
		/** Entitlement that must be on, or the item renders locked. */
		entitlement?: string;
	};
	const GROUPS: Array<{ label: string; items: Item[] }> = [
		{
			// Daily work — what the business opens every morning.
			label: '',
			items: [
				{ href: '/app', label: 'Home', icon: 'M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1v-6.5Z', permission: null, primary: true },
				{ href: '/app/conversations', label: 'Inbox', icon: 'M3 4h14v9H7l-4 3V4Z', permission: 'conversations:read', primary: true },
				{ href: '/app/customers', label: 'Customers', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0H4Z', permission: 'customers:read' }
			]
		},
		{
			// Operational modules — only the ones this business actually runs on.
			label: 'Work',
			items: [
				{ href: '/app/booking-requests', label: 'Enquiries', icon: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Z', permission: 'booking_requests:read', primary: true, capability: 'BOOKINGS' },
				{ href: '/app/bookings', label: 'Bookings', icon: 'M3 5h14v12H3V5Zm2 3h10v2H5V8Z', permission: 'bookings:read', capability: 'BOOKINGS' },
				{ href: '/app/orders', label: 'Orders', icon: 'M5 4h10l1.5 3v9a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V7L5 4Zm-1 3h12M8 10a2 2 0 0 0 4 0', permission: 'orders:read', primary: true, capability: 'ORDERS', entitlement: 'orders.enabled' },
				{ href: '/app/quotations', label: 'Quotations', icon: 'M5 3h7l3 3v11H5V3Zm7 0v3h3', permission: 'quotations:read', entitlement: 'quotations.enabled' },
				{ href: '/app/payments', label: 'Payments', icon: 'M2 6h16v8H2V6Zm0 3h16', permission: 'payments:read' }
			]
		},
		{
			// Setup and less-than-daily tools. Configuration lives here, not up top.
			label: 'More',
			items: [
				{ href: '/app/whatsapp', label: 'WhatsApp', icon: 'M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2Z', permission: 'whatsapp:read', entitlement: 'whatsapp.enabled' },
				{ href: '/app/whatsapp/templates', label: 'Message templates', icon: 'M4 4h12v4H4V4Zm0 6h12v2H4v-2Zm0 4h8v2H4v-2Z', permission: 'whatsapp:read', entitlement: 'whatsapp.templatesEnabled' },
				{ href: '/app/forms', label: 'Forms & widgets', icon: 'M4 4h12v3H4V4Zm0 5h12v3H4V9Zm0 5h7v3H4v-3Z', permission: 'forms:read', entitlement: 'forms.hostedEnabled' },
				{ href: '/app/catalog', label: 'Catalog', icon: 'M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v11l-3-1.8L10 16l-3-1.8L4 16V5Z', permission: 'catalog:read', capability: 'ORDERS' },
				{ href: '/app/leads', label: 'Leads', icon: 'M3 16 8 9l3 3 6-8', permission: 'leads:read', capability: 'BOOKINGS' },
				{ href: '/app/developers', label: 'Integrations', icon: 'M7 5 3 10l4 5m6-10 4 5-4 5', permission: 'api_keys:read', entitlement: 'api.enabled' },
				{ href: '/app/settings', label: 'Settings', icon: 'M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', permission: 'tenant:read' }
			]
		}
	];

	const allowed = (item: Item) => {
		if (item.permission && !data.permissions?.includes(item.permission as never)) return false;
		if (item.capability && data.tenant.capabilities !== 'BOTH' && data.tenant.capabilities !== item.capability) return false;
		return true;
	};
	/** Locked = visible but not navigable, so the tenant can see what a plan adds. */
	const locked = (item: Item) => !!item.entitlement && data.entitlements?.[item.entitlement] !== true;
	const groups = $derived(GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length));
	const flat = $derived(groups.flatMap((g) => g.items));
	const primary = $derived(flat.filter((n) => n.primary).slice(0, 3));
	const current = $derived(flat.find((n) => isActive(n.href))?.label ?? 'Overview');

	/** Global "+ New" (§6): only what this tenant can create, one tap from anywhere. */
	type QuickItem = { href: string; label: string; hint: string };
	const quickCreate = $derived.by(() => {
		const items: QuickItem[] = [];
		const can = (perm: string) => data.permissions?.includes(perm as never);
		const orders = data.tenant.capabilities !== 'BOOKINGS' && data.entitlements?.['orders.enabled'] === true;
		const bookings = data.tenant.capabilities !== 'ORDERS';
		if (orders && can('orders:write')) {
			items.push({ href: '/app/orders/new', label: 'New order', hint: 'Record a customer order' });
			items.push({ href: '/app/orders/batches', label: 'New batch', hint: 'A selling round with shared price' });
		}
		if (bookings && can('booking_requests:write')) {
			items.push({ href: '/app/booking-requests', label: 'New enquiry', hint: 'Log a booking enquiry' });
		}
		if (data.entitlements?.['quotations.enabled'] === true && can('quotations:write') && bookings) {
			items.push({ href: '/app/quotations', label: 'New quotation', hint: 'Draft a quote to send' });
		}
		if (can('customers:write')) {
			items.push({ href: '/app/customers?new=1', label: 'New customer', hint: 'Add someone manually' });
		}
		return items;
	});
	let quickOpen = $state(false);

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
		void goto(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search');
	}
</script>

<Toasts />

<div class="flex min-h-screen">
	<!-- Sidenav (desktop) -->
	<aside class="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-slate-200 bg-white lg:flex {collapsed ? 'w-[70px]' : 'w-60'} transition-[width] duration-200">
		<div class="flex h-[70px] items-center gap-2.5 border-b border-slate-200 {collapsed ? 'justify-center px-2' : 'px-5'}">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
			{#if !collapsed}
				<div class="min-w-0">
					<div class="truncate text-[15px] font-bold tracking-tight text-slate-800">Makutano</div>
					<div class="-mt-0.5 text-[10px] font-semibold tracking-widest text-brand-500 uppercase">Connect</div>
				</div>
			{/if}
		</div>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			{#each groups as group (group.label)}
				{#if !collapsed}
					<p class="px-2.5 pt-3 pb-2 text-[10px] font-bold tracking-widest text-slate-400 uppercase first:pt-0">{group.label}</p>
				{:else}
					<div class="mx-2 my-3 border-t border-slate-100 first:hidden"></div>
				{/if}
				<div class="space-y-0.5">
					{#each group.items as item (item.href)}
						{#if locked(item)}
							<div
								title="{item.label} is not included in your {data.planName} plan"
								class="flex cursor-not-allowed items-center gap-3 rounded-panel py-2 text-[13.5px] text-slate-300 {collapsed ? 'justify-center px-0' : 'px-2.5'}"
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
								class="flex items-center gap-3 rounded-panel py-2 text-[13.5px] transition {collapsed ? 'justify-center px-0' : 'px-2.5'} {isActive(item.href)
									? 'bg-brand-50 font-semibold text-brand-600'
									: 'text-slate-500 hover:bg-[#f3f1fa] hover:text-slate-700'}"
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
				<a href="/admin" class="block rounded-panel px-2.5 py-1.5 text-xs text-slate-500 hover:bg-[#f3f1fa]">Super admin →</a>
			</div>
		{/if}
	</aside>

	<div class="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0 {collapsed ? 'lg:pl-[70px]' : 'lg:pl-60'} transition-[padding] duration-200">
		<!-- Topbar -->
		<header class="sticky top-0 z-20 flex h-[60px] items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:h-[70px] lg:px-6">
			<div class="flex min-w-0 items-center gap-3">
				<button class="hidden rounded-panel p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:block" onclick={toggleNav} aria-label="Toggle navigation">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
				</button>
				<div class="flex size-7 items-center justify-center rounded-panel bg-brand-500 text-xs font-bold text-white lg:hidden">M</div>

				<form onsubmit={submitSearch} class="relative hidden md:block">
					<input bind:value={search} placeholder="Search customers, orders, references…" class="w-64 rounded-panel border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-[13px] placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-1 focus:ring-brand-500" />
					<svg class="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.4 9.84l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" /></svg>
				</form>
				<h2 class="truncate text-[15px] font-semibold text-slate-800 md:hidden">{current}</h2>
			</div>

			<div class="flex items-center gap-1.5">
				{#if quickCreate.length}
					<div class="relative">
						<button class="btn-primary !py-1.5 text-[13px]" onclick={() => (quickOpen = !quickOpen)} aria-label="Create new">
							<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4v12M4 10h12" /></svg>
							<span class="hidden sm:inline">New</span>
						</button>
						{#if quickOpen}
							<button class="fixed inset-0 z-20 hidden cursor-default lg:block" onclick={() => (quickOpen = false)} aria-label="Close menu" tabindex="-1"></button>
							<div class="absolute right-0 z-30 mt-1 hidden w-60 rounded-panel border border-slate-200 bg-white py-1 shadow-md lg:block">
								{#each quickCreate as item (item.href)}
									<a href={item.href} class="block px-3 py-2 hover:bg-slate-50" onclick={() => (quickOpen = false)}>
										<div class="text-[13px] font-medium text-slate-700">{item.label}</div>
										<div class="text-[11px] text-slate-400">{item.hint}</div>
									</a>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<a href="/app/conversations" class="relative rounded-panel p-2 text-slate-500 hover:bg-slate-100" aria-label="Inbox notifications">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4-1.5 4.8-.2.3 0 .7.4.7h11.2c.4 0 .6-.4.4-.7-.5-.8-1.5-1.8-1.5-4.8A4.5 4.5 0 0 0 10 3Zm-1.7 10.8a1.8 1.8 0 0 0 3.4 0" /></svg>
					{#if data.unreadCount > 0}
						<span class="absolute -top-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span>
					{/if}
				</a>

				<div class="relative">
					<button class="flex items-center gap-2 rounded-panel p-1.5 hover:bg-slate-100" onclick={() => (userMenu = !userMenu)} aria-label="Account menu">
						<div class="flex size-8 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">
							{(data.user.fullName || data.user.email).slice(0, 1).toUpperCase()}
						</div>
						<div class="hidden text-left lg:block">
							<div class="text-[13px] leading-4 font-semibold text-slate-700">{data.user.fullName || data.user.email.split('@')[0]}</div>
							<div class="text-[11px] leading-4 text-slate-400 capitalize">{data.role?.replace(/_/g, ' ').toLowerCase()}</div>
						</div>
					</button>
					{#if userMenu}
						<div class="absolute right-0 z-30 mt-1 w-48 rounded-panel border border-slate-200 bg-white py-1 shadow-md">
							<div class="border-b border-slate-100 px-3 py-2">
								<div class="truncate text-[13px] font-semibold text-slate-700">{data.tenant.name}</div>
								<div class="truncate text-[11px] text-slate-400">{data.user.email}</div>
							</div>
							{#if data.user.isSuperAdmin}
								<a href="/admin" class="block px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">Super admin</a>
							{/if}
							<a href="/app/settings" class="block px-3 py-2 text-[13px] text-slate-600 hover:bg-slate-50">Settings</a>
							<form method="POST" action="/logout">
								<button type="submit" class="w-full px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/5">Sign out</button>
							</form>
						</div>
					{/if}
				</div>
			</div>
		</header>

		<main class="mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 lg:p-6">
			{#if data.tenantSuspended}
				<div class="mb-4 rounded-panel bg-danger/10 px-4 py-3 text-sm text-danger">
					<b>This account is suspended.</b> You can still view your data, but new orders, bookings, messages and API writes are blocked. Please contact support.
				</div>
			{:else if data.trial}
				<div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-panel bg-brand-50 px-4 py-2.5 text-xs text-brand-800">
					<span>
						{#if trialDaysLeft === null}
							You're on a free trial — everything is switched on.
						{:else if trialDaysLeft > 1}
							<b>{trialDaysLeft} days</b> left on your free trial. Nothing is charged until you choose a plan.
						{:else if trialDaysLeft === 1}
							Your free trial ends <b>tomorrow</b>.
						{:else}
							Your free trial ends <b>today</b>.
						{/if}
					</span>
					<a href="/app/settings" class="font-semibold underline">Manage plan</a>
				</div>
			{:else if data.nearLimits?.length}
				<div class="mb-4 rounded-panel bg-warning/10 px-4 py-2.5 text-xs text-[#b58514]">
					You're approaching your monthly limit —
					{#each data.nearLimits as l, i (l.label)}{i > 0 ? ', ' : ' '}<b>{l.label.toLowerCase()} {l.used}/{l.limit}</b>{/each}.
					<a href="/app/settings" class="font-semibold underline">View usage</a>
				</div>
			{/if}
			{@render children()}
			<footer class="mt-8 text-center text-[11px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</footer>
		</main>
	</div>

	<!-- Mobile bottom tabs: the three most-used destinations + Create in the middle (§22) -->
	<nav class="fixed inset-x-0 bottom-0 z-20 grid border-t border-slate-200 bg-white lg:hidden" style="grid-template-columns: repeat({quickCreate.length ? primary.length + 1 : primary.length}, 1fr)">
		{#each primary.slice(0, 2) as item (item.href)}
			<a href={item.href} class="flex flex-col items-center gap-0.5 py-2 text-[10px] {isActive(item.href) ? 'font-semibold text-brand-500' : 'text-slate-400'}">
				<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
				{item.label}
			</a>
		{/each}
		{#if quickCreate.length}
			<button class="flex flex-col items-center gap-0.5 py-2 text-[10px] text-slate-400" onclick={() => (quickOpen = !quickOpen)} aria-label="Create new">
				<span class="flex size-6 items-center justify-center rounded-full bg-brand-500 text-white">
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 4v12M4 10h12" /></svg>
				</span>
				New
			</button>
		{/if}
		{#each primary.slice(2) as item (item.href)}
			<a href={item.href} class="flex flex-col items-center gap-0.5 py-2 text-[10px] {isActive(item.href) ? 'font-semibold text-brand-500' : 'text-slate-400'}">
				<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
				{item.label}
			</a>
		{/each}
	</nav>

	<!-- Mobile create sheet -->
	{#if quickOpen}
		<div class="fixed inset-0 z-40 flex items-end bg-slate-900/40 lg:hidden">
			<button class="absolute inset-0 cursor-default" onclick={() => (quickOpen = false)} aria-label="Close" tabindex="-1"></button>
			<div class="relative z-10 w-full rounded-t-2xl bg-white p-4 pb-8 shadow-lg">
				<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200"></div>
				<p class="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Create</p>
				<div class="space-y-1">
					{#each quickCreate as item (item.href)}
						<a href={item.href} class="block rounded-panel px-3 py-3 hover:bg-slate-50 active:bg-slate-100" onclick={() => (quickOpen = false)}>
							<div class="text-sm font-medium text-slate-700">{item.label}</div>
							<div class="text-[11px] text-slate-400">{item.hint}</div>
						</a>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
