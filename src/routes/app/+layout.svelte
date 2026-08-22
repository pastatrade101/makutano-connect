<script lang="ts">
	// Reback vertical layout: fixed white topbar, light sidenav with quiet gray items
	// and a soft primary tint on the active route; bottom tab bar on mobile.
	import { page } from '$app/state';
	let { data, children } = $props();

	const NAV = [
		{ href: '/app', label: 'Overview', icon: 'M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1v-6.5Z', permission: null, primary: true },
		{ href: '/app/booking-requests', label: 'Requests', icon: 'M4 3h12v14l-3-2-3 2-3-2-3 2V3Z', permission: 'booking_requests:read', primary: true },
		{ href: '/app/bookings', label: 'Bookings', icon: 'M3 5h14v12H3V5Zm2 3h10v2H5V8Z', permission: 'bookings:read', primary: true },
		{ href: '/app/conversations', label: 'Inbox', icon: 'M3 4h14v9H7l-4 3V4Z', permission: 'conversations:read', primary: true },
		{ href: '/app/quotations', label: 'Quotations', icon: 'M5 3h7l3 3v11H5V3Zm7 0v3h3', permission: 'quotations:read' },
		{ href: '/app/customers', label: 'Customers', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 7a6 6 0 0 1 12 0H4Z', permission: 'customers:read' },
		{ href: '/app/leads', label: 'Leads', icon: 'M3 16 8 9l3 3 6-8', permission: 'leads:read' },
		{ href: '/app/payments', label: 'Payments', icon: 'M2 6h16v8H2V6Zm0 3h16', permission: 'payments:read' },
		{ href: '/app/whatsapp', label: 'WhatsApp', icon: 'M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2Z', permission: 'whatsapp:read' },
		{ href: '/app/developers', label: 'Developers', icon: 'M7 5 3 10l4 5m6-10 4 5-4 5', permission: 'api_keys:read' },
		{ href: '/app/settings', label: 'Settings', icon: 'M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', permission: 'tenant:read' }
	];

	const visible = $derived(NAV.filter((n) => !n.permission || data.permissions?.includes(n.permission as never)));
	const primary = $derived(visible.filter((n) => n.primary).slice(0, 4));
	const current = $derived(visible.find((n) => isActive(n.href))?.label ?? 'Overview');

	function isActive(href: string): boolean {
		return href === '/app' ? page.url.pathname === '/app' : page.url.pathname.startsWith(href);
	}
</script>

<div class="flex min-h-screen">
	<!-- Sidenav (desktop) -->
	<aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
		<div class="flex h-[70px] items-center gap-2.5 border-b border-slate-200 px-5">
			<div class="flex size-8 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
			<div class="min-w-0">
				<div class="truncate text-[15px] font-bold tracking-tight text-slate-800">Makutano</div>
				<div class="-mt-0.5 text-[10px] font-semibold tracking-widest text-brand-500 uppercase">Connect</div>
			</div>
		</div>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			<p class="px-2.5 pb-2 text-[10px] font-bold tracking-widest text-slate-400 uppercase">Menu</p>
			<div class="space-y-0.5">
				{#each visible as item (item.href)}
					<a
						href={item.href}
						class="flex items-center gap-3 rounded-panel px-2.5 py-2 text-[13.5px] transition {isActive(item.href)
							? 'bg-brand-50 font-semibold text-brand-600'
							: 'text-slate-500 hover:bg-[#f3f1fa] hover:text-slate-700'}"
					>
						<svg class="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
						{item.label}
					</a>
				{/each}
			</div>
		</nav>

		<div class="border-t border-slate-200 p-3">
			{#if data.user.isSuperAdmin}
				<a href="/admin" class="mb-1 block rounded-panel px-2.5 py-1.5 text-xs text-slate-500 hover:bg-[#f3f1fa]">Super admin →</a>
			{/if}
		</div>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0 lg:pl-60">
		<!-- Topbar -->
		<header class="sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-slate-200 bg-white px-4 lg:h-[70px] lg:px-6">
			<div class="flex items-center gap-3">
				<div class="flex size-7 items-center justify-center rounded-panel bg-brand-500 text-xs font-bold text-white lg:hidden">M</div>
				<div>
					<h2 class="text-[15px] font-semibold text-slate-800">{current}</h2>
					<p class="hidden text-[11px] text-slate-400 lg:block">{data.tenant.name}</p>
				</div>
			</div>
			<div class="flex items-center gap-3">
				<div class="hidden text-right lg:block">
					<div class="text-[13px] font-semibold text-slate-700">{data.user.fullName || data.user.email}</div>
					<div class="text-[11px] text-slate-400 capitalize">{data.role?.replace(/_/g, ' ').toLowerCase()}</div>
				</div>
				<div class="flex size-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-600">
					{(data.user.fullName || data.user.email).slice(0, 1).toUpperCase()}
				</div>
				<form method="POST" action="/logout">
					<button type="submit" class="rounded-panel px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100" title="Sign out">
						<svg class="size-4.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 6V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2m2-8 3 4-3 4m-8-4h11" /></svg>
					</button>
				</form>
			</div>
		</header>

		<main class="min-w-0 flex-1 p-4 lg:p-6">{@render children()}</main>
	</div>

	<!-- Mobile bottom tabs -->
	<nav class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white lg:hidden">
		{#each primary as item (item.href)}
			<a href={item.href} class="flex flex-col items-center gap-0.5 py-2 text-[10px] {isActive(item.href) ? 'font-semibold text-brand-500' : 'text-slate-400'}">
				<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
				{item.label}
			</a>
		{/each}
	</nav>
</div>
