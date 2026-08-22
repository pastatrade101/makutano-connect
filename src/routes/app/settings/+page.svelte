<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const canWrite = $derived(data.permissions?.includes('tenant:write'));

	function pct(used: number, limit: number | undefined): number {
		if (!limit || limit <= 0) return 0;
		return Math.min(100, Math.round((used / limit) * 100));
	}
</script>

<svelte:head><title>Settings · {data.tenant.name}</title></svelte:head>

<div class="max-w-3xl space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Settings</h1>

	{#if form?.success}<p class="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">Settings saved.</p>{/if}
	{#if form?.message}<p class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{form.message}</p>{/if}

	<form method="POST" action="?/save" use:enhance class="card">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Business</header>
		<div class="grid gap-3 p-3 sm:grid-cols-2">
			<div><label class="label" for="name">Business name</label><input id="name" name="name" value={data.settings.name} class="input" disabled={!canWrite} /></div>
			<div><label class="label" for="logoUrl">Logo URL</label><input id="logoUrl" name="logoUrl" value={data.settings.logoUrl ?? ''} class="input" disabled={!canWrite} /></div>
			<div><label class="label" for="timezone">Timezone</label><input id="timezone" name="timezone" value={data.settings.timezone} class="input" disabled={!canWrite} /></div>
			<div><label class="label" for="currency">Currency</label><input id="currency" name="currency" value={data.settings.currency} maxlength="3" class="input" disabled={!canWrite} /></div>
			<div><label class="label" for="country">Country (ISO-2)</label><input id="country" name="country" value={data.settings.country ?? ''} maxlength="2" class="input" disabled={!canWrite} /></div>
			<div><label class="label" for="locale">Locale</label><input id="locale" name="locale" value={data.settings.locale} class="input" disabled={!canWrite} /></div>
			<div>
				<label class="label" for="bookingReferencePrefix">Booking reference prefix</label>
				<input id="bookingReferencePrefix" name="bookingReferencePrefix" value={data.settings.bookingReferencePrefix} class="input" disabled={!canWrite} />
				<p class="mt-1 text-[11px] text-slate-400">New references only, e.g. {data.settings.bookingReferencePrefix}-BK-2026-00001</p>
			</div>
			<div><label class="label" for="quotationPrefix">Quotation prefix</label><input id="quotationPrefix" name="quotationPrefix" value={data.settings.quotationPrefix} class="input" disabled={!canWrite} /></div>
		</div>
		{#if canWrite}<div class="border-t border-slate-200 p-3"><button class="btn-primary">Save settings</button></div>{/if}
	</form>

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">Plan &amp; usage</h2>
			<span class="badge bg-brand-50 text-brand-800 ring-1 ring-brand-200">{data.plan.code}</span>
		</header>
		<div class="space-y-3 p-3">
			{#each [{ label: 'API requests', used: data.usage.apiRequests, limit: data.plan.limits.api_requests_per_minute ? undefined : undefined }, { label: 'Booking requests', used: data.usage.bookingRequests, limit: data.plan.limits.booking_requests_per_month }, { label: 'WhatsApp messages sent', used: data.usage.whatsappOutbound, limit: data.plan.limits.whatsapp_outbound_per_month }] as row (row.label)}
				<div>
					<div class="flex justify-between text-xs">
						<span class="text-slate-600">{row.label}</span>
						<span class="tabular-nums text-slate-500">{row.used}{row.limit ? ` / ${row.limit}` : ''}</span>
					</div>
					{#if row.limit}
						<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full {pct(row.used, row.limit) > 85 ? 'bg-red-500' : 'bg-brand-500'}" style="width: {pct(row.used, row.limit)}%"></div>
						</div>
					{/if}
				</div>
			{/each}
			<p class="text-[11px] text-slate-400">Billing period {data.period} · times shown in {data.settings.timezone}</p>
		</div>
	</section>

	<section class="card">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Team</header>
		<table class="min-w-full divide-y divide-slate-100">
			<thead class="bg-slate-50"><tr><th class="table-head">Name</th><th class="table-head">Email</th><th class="table-head">Role</th></tr></thead>
			<tbody class="divide-y divide-slate-100">
				{#each data.members as m (m.id)}
					<tr><td class="table-cell">{m.fullName || '—'}</td><td class="table-cell text-slate-600">{m.email}</td><td class="table-cell text-[11px] uppercase text-slate-500">{m.role.replace(/_/g, ' ')}</td></tr>
				{/each}
			</tbody>
		</table>
	</section>
</div>
