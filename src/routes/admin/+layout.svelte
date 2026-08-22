<script lang="ts">
	import { page } from '$app/state';
	let { data, children } = $props();

	const NAV = [
		{ href: '/admin', label: 'System health' },
		{ href: '/admin/tenants', label: 'Tenants' },
		{ href: '/admin/usage', label: 'Usage & subscriptions' },
		{ href: '/admin/whatsapp', label: 'WhatsApp connections' },
		{ href: '/admin/errors', label: 'Delivery & payment errors' },
		{ href: '/admin/audit', label: 'Audit logs' }
	];

	const isActive = (href: string) => (href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href));
</script>

<div class="flex min-h-screen">
	<aside class="hidden w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-300 lg:flex">
		<div class="border-b border-slate-800 px-3 py-3">
			<div class="text-sm font-semibold text-white">Makutano Admin</div>
			<div class="text-[11px] text-slate-400">Platform operations</div>
		</div>
		<nav class="flex-1 space-y-0.5 p-2">
			{#each NAV as item (item.href)}
				<a href={item.href} class="block rounded-md px-2 py-1.5 text-sm {isActive(item.href) ? 'bg-slate-800 font-medium text-white' : 'hover:bg-slate-800/60'}">{item.label}</a>
			{/each}
		</nav>
		<div class="border-t border-slate-800 p-2 text-[11px]">
			<a href="/app" class="block rounded-md px-2 py-1.5 hover:bg-slate-800/60">← Tenant portal</a>
			<div class="truncate px-2 py-1 text-slate-400">{data.user.email}</div>
			<form method="POST" action="/logout"><button class="w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-800/60">Sign out</button></form>
		</div>
	</aside>

	<main class="min-w-0 flex-1 bg-slate-50 p-3 sm:p-4">{@render children()}</main>
</div>
