<script lang="ts">
	import { enhance } from '$app/forms';
	import EmptyState from '$components/EmptyState.svelte';
	import FormToast from '$components/FormToast.svelte';
	import Money from '$components/Money.svelte';
	let { data, form } = $props();
	let showForm = $state(data.batches.length === 0);

	const fmtDate = (d: string | Date | null) =>
		d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
</script>

<svelte:head><title>Order batches · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Batch saved" />

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<div>
			<a href="/app/orders" class="text-xs text-slate-500 hover:underline">← Orders</a>
			<h1 class="text-base font-semibold text-slate-800">Batches</h1>
		</div>
		<button class="btn-primary" onclick={() => (showForm = !showForm)}>New batch</button>
	</div>

	{#if showForm}
		<form method="POST" action="?/create" use:enhance class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
			{#if form?.message}
				<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger sm:col-span-2 lg:col-span-3">{form.message}</p>
			{/if}
			<div class="sm:col-span-2">
				<label class="label" for="b-name">Batch name</label>
				<input id="b-name" name="name" required class="input" placeholder="Saturday Fish Delivery — 4 July" />
			</div>
			<div>
				<label class="label" for="b-date">Delivery day</label>
				<input id="b-date" name="fulfilmentDate" type="date" class="input" />
			</div>
			<div>
				<label class="label" for="b-item">Item</label>
				<input id="b-item" name="itemTitle" required class="input" placeholder="Fresh Fish" />
			</div>
			<div>
				<label class="label" for="b-unit">Unit</label>
				<input id="b-unit" name="unit" list="unit-options" class="input" placeholder="KG" />
				<datalist id="unit-options">
					{#each data.units as u (u)}<option value={u}></option>{/each}
				</datalist>
			</div>
			<div>
				<label class="label" for="b-price">Price per unit ({data.tenant.currency})</label>
				<input id="b-price" name="unitPrice" inputmode="decimal" class="input" placeholder="14000" />
			</div>
			<div>
				<label class="label" for="b-method">Delivery / pickup</label>
				<select id="b-method" name="deliveryMethod" class="input">
					<option value="">—</option><option value="DELIVERY">Delivery</option><option value="PICKUP">Pickup</option>
				</select>
			</div>
			<div class="sm:col-span-2">
				<label class="label" for="b-desc">Description <span class="font-normal text-slate-400">(optional)</span></label>
				<input id="b-desc" name="description" class="input" placeholder="Orders from the neighbourhood WhatsApp group" />
			</div>
			<div class="flex items-end"><button class="btn-primary w-full">Create batch</button></div>
		</form>
	{/if}

	<div class="flex gap-2 text-xs">
		<a href="/app/orders/batches" class="rounded-full px-3 py-1 {!data.status ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}">All</a>
		<a href="/app/orders/batches?status=OPEN" class="rounded-full px-3 py-1 {data.status === 'OPEN' ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}">Open</a>
		<a href="/app/orders/batches?status=CLOSED" class="rounded-full px-3 py-1 {data.status === 'CLOSED' ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 border border-slate-200'}">Closed</a>
	</div>

	{#if data.batches.length === 0}
		<div class="card">
			<EmptyState
				title="No batches yet"
				description="A batch is one selling round — “Saturday Fish Delivery, KG, TZS 14,000”. Create it once, then record each customer with just a name and a quantity."
			/>
		</div>
	{:else}
		<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.batches as b (b.id)}
				<a href="/app/orders/batches/{b.id}" class="card block p-4 transition hover:border-brand-300">
					<div class="flex items-start justify-between gap-2">
						<h2 class="text-sm font-semibold text-slate-800">{b.name}</h2>
						<span class="badge {b.status === 'OPEN' ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-500'}">{b.status === 'OPEN' ? 'Open' : 'Closed'}</span>
					</div>
					<p class="mt-1 text-xs text-slate-500">
						{b.defaultItemTitle}{b.defaultUnit ? ` · per ${b.defaultUnit}` : ''} ·
						<Money amount={b.defaultUnitPrice} currency={b.currency} />
					</p>
					<div class="mt-3 flex items-center justify-between text-xs">
						<span class="text-slate-500">{fmtDate(b.fulfilmentDate)}</span>
						<span class="font-medium text-slate-700">{b.orders} orders · <Money amount={b.revenue} currency={b.currency} /></span>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
