<script lang="ts">
	// Dense operational shell (§22): a narrow fixed sidebar on desktop, a bottom tab bar
	// on mobile so the portal feels like an app rather than a shrunken website.
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

	function isActive(href: string): boolean {
		return href === '/app' ? page.url.pathname === '/app' : page.url.pathname.startsWith(href);
	}
</script>

<div class="flex min-h-screen">
	<!-- Desktop sidebar -->
	<aside class="hidden w-52 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
		<div class="flex items-center gap-2 border-b border-slate-200 px-3 py-3">
			<div class="flex size-7 items-center justify-center rounded bg-brand-700 text-sm font-bold text-white">M</div>
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-slate-900">{data.tenant.name}</div>
				<div class="truncate text-[11px] text-slate-500">Makutano Connect</div>
			</div>
		</div>

		<nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
			{#each visible as item (item.href)}
				<a
					href={item.href}
					class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition {isActive(item.href)
						? 'bg-brand-50 font-medium text-brand-800'
						: 'text-slate-600 hover:bg-slate-50'}"
				>
					<svg class="size-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="border-t border-slate-200 p-2">
			{#if data.user.isSuperAdmin}
				<a href="/admin" class="mb-1 block rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50">Super admin →</a>
			{/if}
			<div class="px-2 pb-1 text-[11px] text-slate-500">
				<div class="truncate font-medium text-slate-700">{data.user.fullName || data.user.email}</div>
				<div class="truncate">{data.role?.replace(/_/g, ' ').toLowerCase()}</div>
			</div>
			<form method="POST" action="/logout">
				<button type="submit" class="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50">Sign out</button>
			</form>
		</div>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col pb-14 lg:pb-0">
		<!-- Mobile top bar -->
		<header class="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
			<div class="flex items-center gap-2">
				<div class="flex size-6 items-center justify-center rounded bg-brand-700 text-xs font-bold text-white">M</div>
				<span class="truncate text-sm font-semibold">{data.tenant.name}</span>
			</div>
			<form method="POST" action="/logout"><button class="text-xs text-slate-500">Sign out</button></form>
		</header>

		<main class="min-w-0 flex-1 p-3 sm:p-4">{@render children()}</main>
	</div>

	<!-- Mobile bottom tabs -->
	<nav class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white lg:hidden">
		{#each primary as item (item.href)}
			<a href={item.href} class="flex flex-col items-center gap-0.5 py-2 text-[10px] {isActive(item.href) ? 'text-brand-700' : 'text-slate-500'}">
				<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
				{item.label}
			</a>
		{/each}
	</nav>
</div>
