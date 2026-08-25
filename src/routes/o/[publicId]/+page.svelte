<script lang="ts">
	// The customer side of an Order Link. One offer, one tiny form, under 30 seconds
	// on a phone. Totals shown here are presentation — the server recomputes them.
	import { enhance } from '$app/forms';
	let { data, form } = $props();

	const link = $derived(data.link);
	let quantity = $state(data.link.minQuantity);
	let method = $state<'DELIVERY' | 'PICKUP'>(data.link.deliveryEnabled && !data.link.pickupEnabled ? 'DELIVERY' : 'PICKUP');
	let submitting = $state(false);
	let errorBanner = $state<HTMLElement | null>(null);
	// Idempotency token per page visit — resubmitting returns the same order.
	const submissionToken = crypto.randomUUID().replace(/-/g, '');

	// FIX: the submit button sits below the fold on a phone, so a validation error
	// at the top of the card looked like "nothing happened". Bring it into view.
	$effect(() => {
		if (form?.message && errorBanner) errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
	});

	const money = (amount: number) => `${link.currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
	const unitPrice = $derived(Number(link.unitPrice));
	const deliveryFee = $derived(method === 'DELIVERY' ? Number(link.deliveryFee) : 0);
	const total = $derived(quantity * unitPrice + deliveryFee);
	const canMore = $derived(link.maxOrderable == null || quantity < link.maxOrderable);
	const dateLabel = (iso: string) =>
		new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

	const receipt = $derived(form?.success ? form.receipt : null);
</script>

<svelte:head>
	<title>{link.title} · {link.business.name}</title>
	<meta name="description" content={link.description ?? `Order ${link.title} from ${link.business.name}.`} />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-6">
	<div class="w-full max-w-md">
		<!-- Business header -->
		<div class="mb-5 flex items-center gap-3">
			{#if link.business.logoUrl}
				<img src={link.business.logoUrl} alt="" class="size-11 rounded-xl object-cover" />
			{:else}
				<span class="flex size-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
					{link.business.name.slice(0, 1).toUpperCase()}
				</span>
			{/if}
			<div class="min-w-0">
				<div class="truncate text-[15px] font-bold tracking-tight text-slate-900">{link.business.name}</div>
				{#if link.deliveryDate}<div class="text-[11px] text-slate-500">Delivery: {dateLabel(link.deliveryDate)}</div>{/if}
			</div>
		</div>

		{#if receipt}
			<!-- ✓ Success -->
			<div class="card space-y-4 p-6 text-center">
				<span class="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
					<svg class="size-7" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 10.5 4 4 8-9" /></svg>
				</span>
				<div>
					<h1 class="text-lg font-bold text-slate-900">Order received</h1>
					{#if receipt.unit}<p class="mt-1 font-mono text-xs text-slate-500">{receipt.orderNumber}</p>{/if}
				</div>
				{#if receipt.unit}
					<div class="rounded-panel bg-slate-50 p-4 text-sm">
						<div class="flex justify-between"><span class="text-slate-500">{receipt.title}</span><span class="font-semibold text-slate-800">{receipt.quantity} {receipt.unit}</span></div>
						<div class="mt-2 flex justify-between border-t border-slate-200 pt-2"><span class="text-slate-500">Total</span><span class="font-bold text-slate-900">{money(Number(receipt.total))}</span></div>
					</div>
				{/if}
				<p class="text-[13px] leading-relaxed text-slate-500">
					Status: <b class="text-slate-700">Awaiting confirmation</b><br />
					We'll contact you on WhatsApp after reviewing your order.
				</p>
			</div>
		{:else if link.state !== 'OPEN'}
			<!-- Friendly closed state — never a technical error -->
			<div class="card space-y-3 p-8 text-center">
				<span class="mx-auto flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
					<svg class="size-6" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2.5" /></svg>
				</span>
				<h1 class="text-lg font-bold text-slate-900">{link.title}</h1>
				<p class="text-sm text-slate-500">
					{link.state === 'SOLD_OUT' ? 'This offer is sold out.' : 'Ordering for this offer has closed.'}
				</p>
				<p class="text-xs text-slate-400">Contact {link.business.name} on WhatsApp for the next round.</p>
			</div>
		{:else}
			<!-- The offer -->
			<div class="card overflow-hidden">
				{#if link.imageUrl}
					<img src={link.imageUrl} alt={link.title} class="max-h-56 w-full object-cover" />
				{/if}
				<div class="space-y-5 p-5">
					<div>
						<h1 class="text-xl font-bold tracking-tight text-slate-900">{link.title}</h1>
						{#if link.description}<p class="mt-1 text-sm leading-relaxed text-slate-500">{link.description}</p>{/if}
						<p class="mt-2 text-[15px] font-bold text-brand-600">{money(unitPrice)} <span class="font-medium text-slate-400">/ {link.unit}</span></p>
						{#if link.deadline}<p class="mt-1 text-[11px] text-warning">Orders close {dateLabel(link.deadline)}</p>{/if}
					</div>

					{#if form?.message}
						<p bind:this={errorBanner} class="rounded-panel bg-danger/10 px-3 py-2.5 text-[13px] text-danger" role="alert">{form.message}</p>
					{/if}

					<form
						method="POST"
						action="?/submit"
						class="space-y-4"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								await update({ reset: false });
								submitting = false;
							};
						}}
					>
						<input type="hidden" name="submissionToken" value={submissionToken} />
						<input type="hidden" name="sourceTag" value={data.tag ?? ''} />
						<input type="hidden" name="quantity" value={quantity} />
						<input type="hidden" name="deliveryMethod" value={method} />
						<!-- Honeypot -->
						<div class="hidden" aria-hidden="true"><input name="hp_company" tabindex="-1" autocomplete="off" /></div>

						<!-- Quantity -->
						<div class="flex items-center justify-between rounded-panel border border-slate-200 bg-slate-50 p-3">
							<span class="text-sm font-medium text-slate-600">Quantity</span>
							<div class="flex items-center gap-3">
								<button
									type="button"
									class="flex size-11 items-center justify-center rounded-panel border border-slate-300 bg-white text-xl font-bold text-slate-600 active:bg-slate-100 disabled:opacity-40"
									onclick={() => (quantity = Math.max(link.minQuantity, quantity - 1))}
									disabled={quantity <= link.minQuantity}
									aria-label="Decrease quantity"
								>−</button>
								<label class="sr-only" for="ol-qty">Quantity in {link.unit}</label>
								<input
									id="ol-qty"
									type="number"
									inputmode="numeric"
									bind:value={quantity}
									min={link.minQuantity}
									max={link.maxOrderable ?? undefined}
									onblur={() => {
										const n = Math.floor(Number(quantity));
										quantity = !Number.isFinite(n) || n < link.minQuantity ? link.minQuantity : link.maxOrderable != null && n > link.maxOrderable ? link.maxOrderable : n;
									}}
									class="w-20 rounded-panel border border-slate-200 bg-white py-1.5 text-center text-lg font-bold tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none"
								/>
								<span class="text-sm font-medium text-slate-500">{link.unit}</span>
								<button
									type="button"
									class="flex size-11 items-center justify-center rounded-panel border border-slate-300 bg-white text-xl font-bold text-slate-600 active:bg-slate-100 disabled:opacity-40"
									onclick={() => (quantity = quantity + 1)}
									disabled={!canMore}
									aria-label="Increase quantity"
								>+</button>
							</div>
						</div>

						<!-- Total -->
						<div class="flex items-baseline justify-between px-1">
							<span class="text-sm text-slate-500">Total{deliveryFee ? ' (incl. delivery)' : ''}</span>
							<span class="text-xl font-bold tracking-tight text-slate-900">{money(total)}</span>
						</div>

						<div>
							<label class="label" for="ol-name">Your name</label>
							<input id="ol-name" name="name" required autocomplete="name" value={form?.name ?? ''} class="input min-h-12" />
						</div>
						<div>
							<label class="label" for="ol-phone">WhatsApp number</label>
							<input id="ol-phone" name="whatsappPhone" required type="tel" inputmode="tel" autocomplete="tel" placeholder="+255 …" value={form?.whatsappPhone ?? ''} class="input min-h-12" />
						</div>
						{#if link.fields.email !== 'HIDDEN'}
							<div>
								<label class="label" for="ol-email">Email {#if link.fields.email === 'OPTIONAL'}<span class="font-normal text-slate-400">(optional)</span>{/if}</label>
								<input id="ol-email" name="email" type="email" inputmode="email" required={link.fields.email === 'REQUIRED'} value={form?.email ?? ''} class="input min-h-12" />
							</div>
						{/if}

						{#if link.pickupEnabled && link.deliveryEnabled}
							<div class="grid grid-cols-2 gap-2">
								{#each [{ v: 'PICKUP', l: 'Pickup' }, { v: 'DELIVERY', l: 'Delivery' }] as opt (opt.v)}
									<button
										type="button"
										class="min-h-12 rounded-panel border text-sm font-semibold transition {method === opt.v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500'}"
										onclick={() => (method = opt.v as 'DELIVERY' | 'PICKUP')}
									>
										{opt.l}{opt.v === 'DELIVERY' && Number(link.deliveryFee) > 0 ? ` · +${money(Number(link.deliveryFee))}` : ''}
									</button>
								{/each}
							</div>
						{/if}

						{#if method === 'DELIVERY' && link.fields.deliveryLocation !== 'HIDDEN'}
							<div>
								<label class="label" for="ol-location">Delivery location</label>
								<input id="ol-location" name="deliveryLocation" required placeholder="Area, street, landmark…" value={form?.deliveryLocation ?? ''} class="input min-h-12" />
							</div>
						{/if}

						{#if link.fields.note !== 'HIDDEN'}
							<div>
								<label class="label" for="ol-note">Note {#if link.fields.note === 'OPTIONAL'}<span class="font-normal text-slate-400">(optional)</span>{/if}</label>
								<textarea id="ol-note" name="note" rows="2" required={link.fields.note === 'REQUIRED'} class="input" placeholder="Anything we should know?">{form?.note ?? ''}</textarea>
							</div>
						{/if}

						<button type="submit" class="btn-primary min-h-13 w-full !text-[15px] font-semibold" disabled={submitting}>
							{submitting ? 'Placing order…' : 'Place Order'}
						</button>
					</form>
				</div>
			</div>
		{/if}

		<p class="mt-6 text-center text-[10.5px] text-slate-400">
			Powered by <a href="/" class="font-semibold text-slate-500 hover:underline">Makutano Connect</a>
		</p>
	</div>
</div>
