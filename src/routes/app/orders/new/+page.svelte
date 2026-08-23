<script lang="ts">
	// Record an order the way a WhatsApp seller thinks about it: who, what, how many,
	// how it reaches them. Catalog quick-pick fills names and prices; free-text rows
	// cover everything the catalog doesn't. Nothing here is a storefront.
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	let { data, form } = $props();

	type Row = { catalogItemId: string | null; title: string; variant: string; quantity: number; unitPrice: string };
	let rows = $state<Row[]>([{ catalogItemId: null, title: '', variant: '', quantity: 1, unitPrice: '' }]);
	let discount = $state('');
	let deliveryFee = $state('');

	const subtotal = $derived(rows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * (r.quantity || 1), 0));
	const total = $derived(Math.max(0, subtotal - (Number(discount) || 0) + (Number(deliveryFee) || 0)));

	function addRow() {
		rows.push({ catalogItemId: null, title: '', variant: '', quantity: 1, unitPrice: '' });
	}
	function addFromCatalog(id: string) {
		const item = data.catalog.find((c) => c.id === id);
		if (!item) return;
		rows.push({ catalogItemId: item.id, title: item.name, variant: '', quantity: 1, unitPrice: item.price ?? '' });
		if (rows.length > 1 && !rows[0].title) rows.shift();
	}
	const validRows = $derived(rows.filter((r) => r.title.trim()));
</script>

<svelte:head><title>New order · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Order saved" />

<div class="mx-auto max-w-3xl space-y-3">
	<div>
		<a href="/app/orders" class="text-xs text-slate-500 hover:underline">← Orders</a>
		<h1 class="text-base font-semibold text-slate-800">New order</h1>
	</div>

	{#if data.conversation}
		<p class="rounded-panel bg-brand-50 px-3 py-2 text-xs text-brand-700">
			From WhatsApp conversation with <b>{data.conversation.customerName}</b> — customer and thread will be linked automatically.
		</p>
	{/if}

	<form method="POST" action="?/create" use:enhance class="space-y-3">
		<input type="hidden" name="conversationId" value={data.conversation?.id ?? ''} />
		<input type="hidden" name="items" value={JSON.stringify(validRows)} />

		<section class="card p-3">
			<div class="grid gap-3 sm:grid-cols-2">
				{#if !data.conversation}
					<div>
						<label class="label" for="customerId">Customer</label>
						<select id="customerId" name="customerId" class="input">
							<option value="">— choose customer —</option>
							{#each data.customers as c (c.id)}
								<option value={c.id}>{[c.firstName, c.lastName].filter(Boolean).join(' ')}{c.whatsappPhone ? ` (+${c.whatsappPhone})` : ''}</option>
							{/each}
						</select>
						<p class="mt-1 text-[11px] text-slate-400">New customer? They're created automatically when the order comes from a conversation or form.</p>
					</div>
				{/if}
				<div>
					<label class="label" for="source">Source</label>
					<select id="source" name="source" class="input">
						{#each ['WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'WHATSAPP_GROUP', 'INSTAGRAM', 'FACEBOOK', 'WEBSITE', 'MANUAL', 'OTHER'] as s (s)}
							<option value={s} selected={data.conversation ? s === 'WHATSAPP_DIRECT' : s === 'MANUAL'}>{s.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				</div>
			</div>
		</section>

		<section class="card p-3">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="card-title">Items</h2>
				{#if data.catalog.length}
					<select class="input w-auto py-1.5 text-xs" onchange={(e) => { addFromCatalog(e.currentTarget.value); e.currentTarget.value = ''; }}>
						<option value="">+ from catalog…</option>
						{#each data.catalog as c (c.id)}<option value={c.id}>{c.name}{c.price ? ` — ${c.currency ?? ''} ${c.price}` : ''}</option>{/each}
					</select>
				{/if}
			</div>
			<div class="space-y-2">
				{#each rows as row, i (i)}
					<div class="grid grid-cols-12 gap-2">
						<input placeholder="Item (e.g. Nike Air Max)" bind:value={row.title} class="input col-span-4" />
						<input placeholder="Variant (Black / 43)" bind:value={row.variant} class="input col-span-3" />
						<input type="number" min="1" bind:value={row.quantity} class="input col-span-2" aria-label="Quantity" />
						<input placeholder="Unit price" bind:value={row.unitPrice} class="input col-span-2" />
						<button type="button" class="col-span-1 text-slate-400 hover:text-danger" onclick={() => rows.splice(i, 1)} aria-label="Remove">✕</button>
					</div>
				{/each}
			</div>
			<button type="button" class="btn-secondary mt-2 !py-1.5 text-xs" onclick={addRow}>+ Add line</button>
		</section>

		<section class="card grid gap-3 p-3 sm:grid-cols-4">
			<div><label class="label" for="discount">Discount</label><input id="discount" name="discount" bind:value={discount} placeholder="0.00" class="input" /></div>
			<div><label class="label" for="deliveryFee">Delivery fee</label><input id="deliveryFee" name="deliveryFee" bind:value={deliveryFee} placeholder="0.00" class="input" /></div>
			<div>
				<label class="label" for="deliveryMethod">Delivery / pickup</label>
				<select id="deliveryMethod" name="deliveryMethod" class="input"><option value="">—</option><option value="DELIVERY">Delivery</option><option value="PICKUP">Pickup</option></select>
			</div>
			<div><label class="label" for="deliveryLocation">Location</label><input id="deliveryLocation" name="deliveryLocation" class="input" /></div>
			<div class="sm:col-span-4"><label class="label" for="notes">Notes</label><textarea id="notes" name="notes" rows="2" class="input"></textarea></div>
		</section>

		<div class="card flex flex-wrap items-center justify-between gap-3 p-3">
			<div class="text-sm text-slate-600">
				Subtotal <b class="tabular-nums">{subtotal.toFixed(2)}</b> · Total <b class="text-base tabular-nums text-slate-800">{data.tenant.currency} {total.toFixed(2)}</b>
			</div>
			<div class="flex gap-2">
				<button name="saveAs" value="DRAFT" class="btn-secondary" disabled={!validRows.length}>Save draft</button>
				<button name="saveAs" value="PENDING_CONFIRMATION" class="btn-primary" disabled={!validRows.length}>Save for confirmation</button>
			</div>
		</div>
	</form>
</div>
