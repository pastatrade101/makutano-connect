<script lang="ts">
	// Reback dark-menu variant for the platform admin: sidenav on #262d34 with muted
	// items that light to white, and the same white topbar as the portal.
	import { page } from '$app/state';
	import Toasts from '$components/Toasts.svelte';
	let { data, children } = $props();

	const NAV = [
		{ href: '/admin', label: 'System health', icon: 'M3 10h4l2-5 3 10 2-5h3' },
		{ href: '/admin/tenants', label: 'Tenants', icon: 'M3 17V7l4-3 4 3v10M11 17V9l3-2 3 2v8M3 17h14' },
		{ href: '/admin/usage', label: 'Usage & subscriptions', icon: 'M4 16V9m4 7V5m4 11v-4m4 4V8' },
		{ href: '/admin/whatsapp', label: 'WhatsApp connections', icon: 'M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2Z' },
		{ href: '/admin/errors', label: 'Delivery & payment errors', icon: 'M10 7v4m0 3h.01M4.2 17h11.6a1.5 1.5 0 0 0 1.3-2.2L11.3 4a1.5 1.5 0 0 0-2.6 0L2.9 14.8A1.5 1.5 0 0 0 4.2 17Z' },
		{ href: '/admin/audit', label: 'Audit logs', icon: 'M6 3h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm2 4h4M8 10h4m-4 3h2' }
	];

	const current = $derived(NAV.find((n) => isActive(n.href))?.label ?? 'Admin');
	const isActive = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href));
</script>

<Toasts />

<div class="flex min-h-screen">
	<aside class="hidden w-64 shrink-0 flex-col bg-sidenav-dark lg:flex">
		<div class="flex h-[70px] items-center gap-2.5 border-b border-white/10 px-5">
			<div class="flex size-8 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
			<div>
				<div class="text-[15px] font-bold tracking-tight text-white">Makutano</div>
				<div class="-mt-0.5 text-[10px] font-semibold tracking-widest text-[#9097a7] uppercase">Platform admin</div>
			</div>
		</div>

		<nav class="flex-1 overflow-y-auto px-3 py-4">
			<p class="px-2.5 pb-2 text-[10px] font-bold tracking-widest text-[#5d6675] uppercase">Operations</p>
			<div class="space-y-0.5">
				{#each NAV as item (item.href)}
					<a
						href={item.href}
						class="flex items-center gap-3 rounded-panel px-2.5 py-2 text-[13.5px] transition {isActive(item.href)
							? 'bg-white/10 font-semibold text-white'
							: 'text-[#9097a7] hover:bg-white/5 hover:text-white'}"
					>
						<svg class="size-[18px] shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={item.icon} /></svg>
						{item.label}
					</a>
				{/each}
			</div>
		</nav>

		<div class="border-t border-white/10 p-3 text-[11px]">
			<a href="/app" class="block rounded-panel px-2.5 py-1.5 text-[#9097a7] hover:bg-white/5 hover:text-white">← Tenant portal</a>
			<div class="truncate px-2.5 py-1 text-[#5d6675]">{data.user.email}</div>
			<form method="POST" action="/logout">
				<button type="submit" class="w-full rounded-panel px-2.5 py-1.5 text-left text-[#9097a7] hover:bg-white/5 hover:text-white">Sign out</button>
			</form>
		</div>
	</aside>

	<div class="flex min-w-0 flex-1 flex-col">
		<header class="sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-slate-200 bg-white px-4 lg:h-[70px] lg:px-6">
			<h2 class="text-[15px] font-semibold text-slate-800">{current}</h2>
			<div class="flex items-center gap-3 lg:hidden">
				<a href="/app" class="text-xs text-slate-500">Portal</a>
				<form method="POST" action="/logout"><button class="text-xs text-slate-500">Sign out</button></form>
			</div>
		</header>
		<main class="min-w-0 flex-1 p-4 lg:p-6">
			{@render children()}
			<footer class="mt-8 text-center text-[11px] text-slate-400">{new Date().getFullYear()} © Makutano Connect</footer>
		</main>
	</div>
</div>
