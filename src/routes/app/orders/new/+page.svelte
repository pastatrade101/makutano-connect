<script lang="ts">
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import { sourceLabel, statusLabel } from '$lib/labels';
	// Record an order the way a WhatsApp seller thinks about it: who, what, how many,
	// how it reaches them. Free-text rows throughout — a saved list of products was
	// tried and removed; nobody filled one. Nothing here is a storefront.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	let { data, form } = $props();

	type Row = { title: string; variant: string; quantity: number; unit: string; unitPrice: string };
	// Variants are the exception, not the rule: a row shows one when it has one, or
	// when this person asks for it.
	let variantRows = $state(new Set<number>());
	let rows = $state<Row[]>([{ title: '', variant: '', quantity: 1, unit: '', unitPrice: '' }]);
	let discount = $state('');
	let deliveryFee = $state('');
	let batchId = $state('');
	let deliveryDate = $state('');
	let newCustomerName = $state('');
	let newCustomerPhone = $state('');
	let deliveryMethod = $state('');
	let paymentMethod = $state('');
	let deliveryLocation = $state('');
	let notes = $state('');
	// Advanced values entered before a failed submit must not vanish behind a closed
	// section — anything already filled in forces its section back open.
	const advancedFilled = $derived(
		Boolean(discount.trim() || deliveryFee.trim() || paymentMethod || notes.trim())
	);
	let moreOptionsOpen = $state(false);
	// A rejected field the person cannot see is a dead end: if the server named one
	// that lives in here, or anything advanced is already filled in, the section opens.
	const ADVANCED_FIELDS = ['discount', 'deliveryFee', 'paymentMethod', 'source', 'notes'];
	const moreOptions = $derived(
		moreOptionsOpen ||
			(Boolean(form?.message) && advancedFilled) ||
			ADVANCED_FIELDS.includes(String(form?.field ?? ''))
	);
	$effect(() => {
		const field = String(form?.field ?? '');
		if (!field || !moreOptions) return;
		// Let the section render, then put the cursor on the thing that was wrong.
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus());
	});

	// A pickup has no delivery address. Clearing it here means the server is never sent
	// a location the person has just said does not apply.
	$effect(() => {
		if (deliveryMethod !== 'DELIVERY') deliveryLocation = '';
	});

	/** Selecting a batch fills the first empty row and the delivery details (§27). */
	function applyBatch(id: string) {
		batchId = id;
		const b = data.batches.find((x) => x.id === id);
		if (!b) return;
		const target = rows.find((r) => !r.title.trim()) ?? rows[0];
		target.title = b.itemTitle;
		target.unit = b.unit ?? '';
		target.unitPrice = b.unitPrice ?? '';
		if (b.fulfilmentDate) deliveryDate = new Date(b.fulfilmentDate).toISOString().slice(0, 10);
	}

	const subtotal = $derived(rows.reduce((s, r) => s + (Number(r.unitPrice) || 0) * (r.quantity || 1), 0));
	const total = $derived(Math.max(0, subtotal - (Number(discount) || 0) + (Number(deliveryFee) || 0)));

	function addRow() {
		rows.push({ title: '', variant: '', quantity: 1, unit: '', unitPrice: '' });
	}
	const validRows = $derived(rows.filter((r) => r.title.trim()));
</script>

<svelte:head><title>New order · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Order saved" />

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Orders" />
{:else}
<div class="mx-auto w-full max-w-4xl space-y-3">
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
						<div class="mt-1.5 grid grid-cols-2 gap-2">
							<input name="newCustomerName" bind:value={newCustomerName} placeholder="…or new customer name" class="input !py-1.5 text-xs" />
							<input name="newCustomerPhone" bind:value={newCustomerPhone} placeholder="WhatsApp number (optional)" inputmode="tel" class="input !py-1.5 text-xs" />
						</div>
					</div>
				{/if}
				{#if data.batches.length}
					<div class="sm:col-span-2">
						<label class="label" for="batchId">Batch <span class="font-normal text-slate-400">(optional — fills item, price and delivery day)</span></label>
						<select id="batchId" name="batchId" class="input" value={batchId} onchange={(e) => applyBatch(e.currentTarget.value)}>
							<option value="">— no batch —</option>
							{#each data.batches as b (b.id)}
								<option value={b.id}>{b.name} · {b.itemTitle} @ {b.currency} {b.unitPrice}{b.unit ? `/${b.unit}` : ''}</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>
		</section>

		{#if form?.message}
			<p class="rounded-panel border border-danger/25 bg-danger/5 px-3 py-2.5 text-[13px] text-danger" role="alert">
				<b>Could not save this order.</b>
				{form.message}
			</p>
		{/if}

		<section class="card p-3">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="card-title">Items</h2>
			</div>
			<div class="space-y-2">
				{#each rows as row, i (i)}
					<div class="relative grid grid-cols-2 gap-2 rounded-xl border border-slate-100 p-2 sm:grid-cols-12 sm:rounded-none sm:border-0 sm:p-0">
						<input placeholder="Item (e.g. Fresh Fish)" bind:value={row.title} class="input col-span-2 pr-10 sm:col-span-4 sm:pr-3" />
						{#if row.variant || variantRows.has(i)}
							<input placeholder="Variant (e.g. large)" bind:value={row.variant} class="input col-span-2 sm:col-span-2" />
						{:else}
							<button type="button" class="col-span-2 self-center text-left text-[12.5px] text-brand-600 hover:underline sm:col-span-2" onclick={() => { variantRows.add(i); variantRows = new Set(variantRows); }}>+ variant</button>
						{/if}
						<input type="number" min="1" inputmode="numeric" bind:value={row.quantity} class="input col-span-1 sm:col-span-1" aria-label="Quantity" placeholder="Qty" />
						<input placeholder="Unit" list="unit-options" bind:value={row.unit} class="input col-span-1 sm:col-span-2" aria-label="Unit" />
						<input placeholder="Unit price" inputmode="decimal" bind:value={row.unitPrice} class="input col-span-2 sm:col-span-2" />
						<button type="button" class="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-slate-50 text-slate-400 hover:text-danger sm:static sm:col-span-1 sm:size-auto sm:bg-transparent" onclick={() => rows.splice(i, 1)} aria-label="Remove">✕</button>
					</div>
				{/each}
			</div>
			<button type="button" class="btn-secondary mt-2 !py-1.5 text-xs" onclick={addRow}>+ Add line</button>
		</section>

		<section class="card grid gap-3 p-3 sm:grid-cols-4">
			<div>
				<label class="label" for="deliveryMethod">How are they getting it?</label>
				<select id="deliveryMethod" name="deliveryMethod" bind:value={deliveryMethod} class="input">
					<option value="">Not decided yet</option>
					<option value="DELIVERY">Delivery</option>
					<option value="PICKUP">Pickup</option>
				</select>
			</div>
			<div>
				<label class="label" for="deliveryDate">{deliveryMethod === 'PICKUP' ? 'Pickup date' : 'Delivery date'}</label>
				<input id="deliveryDate" name="deliveryDate" type="date" bind:value={deliveryDate} class="input" />
			</div>

			<!-- Only a delivery needs somewhere to go. -->
			{#if deliveryMethod === 'DELIVERY'}
				<div class="sm:col-span-2">
					<label class="label" for="deliveryLocation">Where to?</label>
					<input id="deliveryLocation" name="deliveryLocation" bind:value={deliveryLocation} placeholder="Mikocheni, near the mosque" class="input" />
				</div>
			{/if}

			{#if !moreOptions}
				<button type="button" class="text-left text-[13px] font-medium text-brand-600 hover:underline sm:col-span-4" onclick={() => (moreOptionsOpen = true)}>
					More options — discount, delivery fee, payment method, notes
				</button>
			{:else}
				<div><label class="label" for="discount">Discount</label><input id="discount" name="discount" bind:value={discount} placeholder="0.00" inputmode="decimal" class="input" /></div>
				<div><label class="label" for="deliveryFee">Delivery fee</label><input id="deliveryFee" name="deliveryFee" bind:value={deliveryFee} placeholder="0.00" inputmode="decimal" class="input" /></div>
				<div>
					<label class="label" for="paymentMethod">Payment method</label>
					<select id="paymentMethod" name="paymentMethod" bind:value={paymentMethod} class="input">
						<option value="">—</option>
						{#each ['Cash on Delivery', 'Mobile Payment', 'Bank Transfer', 'Other'] as m (m)}<option value={m}>{m}</option>{/each}
					</select>
				</div>
				<div>
					<label class="label" for="source">Where did this order come from?</label>
					<select id="source" name="source" class="input">
						{#each ['WHATSAPP_DIRECT', 'WHATSAPP_STATUS', 'WHATSAPP_GROUP', 'PHONE', 'WALK_IN', 'INSTAGRAM', 'FACEBOOK', 'WEBSITE', 'MANUAL', 'OTHER'] as s (s)}
							<option value={s} selected={data.conversation ? s === 'WHATSAPP_DIRECT' : s === 'MANUAL'}>{sourceLabel(s)}</option>
						{/each}
					</select>
				</div>
				<div class="sm:col-span-4"><label class="label" for="notes">Notes</label><textarea id="notes" name="notes" bind:value={notes} rows="2" class="input" placeholder="Call before delivery."></textarea></div>
			{/if}
			<datalist id="unit-options">{#each data.units as u (u)}<option value={u}></option>{/each}</datalist>
		</section>

		<div class="card grid gap-3 p-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
			<div class="text-sm text-slate-600">
				Subtotal <b class="tabular-nums">{subtotal.toFixed(2)}</b> · Total <b class="text-base tabular-nums text-slate-800">{data.tenant.currency} {total.toFixed(2)}</b>
			</div>
			<div class="grid grid-cols-2 gap-2 sm:flex">
				<button name="saveAs" value="DRAFT" class="btn-secondary w-full" disabled={!validRows.length}>Save draft</button>
				<button name="saveAs" value="PENDING_CONFIRMATION" class="btn-primary w-full" disabled={!validRows.length}>Save for confirmation</button>
			</div>
		</div>
	</form>
</div>
{/if}
