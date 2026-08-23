<script lang="ts">
	// Public form renderer — one component drives all four form types from server-fed
	// config. White-label by design: the tenant's name and branding, not Connect's.
	// In embed mode it reports its height to the parent page for a seamless iframe.
	import { onMount, tick } from 'svelte';
	let { data } = $props();

	const c = $derived(data.config);
	const accent = $derived(String((c.branding as Record<string, unknown>)?.accentColor ?? '#1c84ee'));

	let values = $state<Record<string, string>>({});
	let cart = $state<Array<{ catalogItemId: string; quantity: number; variant: string }>>([]);
	let submitting = $state(false);
	let done = $state<string | null>(null);
	let errorMessage = $state<string | null>(null);
	let hp = $state('');

	const isDate = (key: string) => key === 'startDate' || key === 'endDate';
	const isNumber = (key: string) => key === 'adults' || key === 'children' || key === 'quantity';
	const isTextarea = (key: string) => key === 'message' || key === 'notes';

	function toggleCartItem(id: string) {
		const index = cart.findIndex((x) => x.catalogItemId === id);
		if (index >= 0) cart.splice(index, 1);
		else cart.push({ catalogItemId: id, quantity: 1, variant: '' });
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		errorMessage = null;
		try {
			const res = await fetch(`/api/public/widgets/${c.publicId}/submit`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ hp_company: hp, fields: values, items: cart.length ? cart : undefined })
			});
			const out = await res.json();
			if (out.success) done = out.data.message;
			else errorMessage = out.error?.message ?? 'Something went wrong. Please try again.';
		} catch {
			errorMessage = 'Network problem — please try again.';
		} finally {
			submitting = false;
			void reportHeight();
		}
	}

	async function reportHeight() {
		await tick();
		if (data.embedded && window.parent !== window) {
			window.parent.postMessage({ type: 'mk-widget-height', publicId: c.publicId, height: document.documentElement.scrollHeight }, '*');
		}
	}
	onMount(() => {
		void reportHeight();
		const observer = new ResizeObserver(() => void reportHeight());
		observer.observe(document.body);
		return () => observer.disconnect();
	});
</script>

<svelte:head><title>{c.heading ?? 'Enquiry'} · {c.businessName}</title></svelte:head>

<div class="{data.embedded ? '' : 'flex min-h-screen items-start justify-center bg-canvas px-4 py-10'}">
	<div class="{data.embedded ? '' : 'w-full max-w-lg'}">
		{#if !data.embedded}
			<p class="mb-3 text-center text-sm font-semibold text-slate-700">{c.businessName}</p>
		{/if}

		<div class="card p-5" style="--accent: {accent}">
			{#if done}
				<div class="py-6 text-center">
					<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
						<svg class="size-6" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 10.5 8 14l8-8" /></svg>
					</div>
					<p class="text-sm text-slate-700">{done}</p>
				</div>
			{:else}
				{#if c.heading}<h1 class="text-lg font-bold text-slate-800">{c.heading}</h1>{/if}
				{#if c.description}<p class="mt-1 text-[13px] text-slate-500">{c.description}</p>{/if}

				<form onsubmit={submit} class="mt-4 space-y-3">
					<input type="text" name="hp_company" bind:value={hp} tabindex="-1" autocomplete="off" aria-hidden="true" class="absolute -left-[9999px] h-0 w-0 opacity-0" />

					{#if c.type === 'ORDER' && c.catalog.length}
						<div>
							<span class="label">Choose products</span>
							<div class="space-y-1.5">
								{#each c.catalog as item (item.id)}
									{@const inCart = cart.find((x) => x.catalogItemId === item.id)}
									<div class="rounded-panel border {inCart ? 'border-brand-500 bg-brand-50/40' : 'border-slate-200'} p-2.5">
										<label class="flex cursor-pointer items-center justify-between gap-2">
											<span class="flex items-center gap-2.5">
												<input type="checkbox" checked={!!inCart} onchange={() => toggleCartItem(item.id)} class="rounded border-slate-300" />
												<span class="text-sm font-medium text-slate-700">{item.name}</span>
											</span>
											{#if item.price}<span class="text-[13px] font-semibold text-slate-600">{item.currency ?? ''} {item.price}</span>{/if}
										</label>
										{#if inCart}
											<div class="mt-2 flex gap-2 pl-6">
												<input type="number" min="1" max="999" bind:value={inCart.quantity} class="input w-20 py-1.5" aria-label="Quantity" />
												{#if item.variants.length}
													<select bind:value={inCart.variant} class="input py-1.5">
														<option value="">Choose option…</option>
														{#each item.variants as v, i (i)}
															<option value={String(v.label ?? '')}>{String(v.label ?? '')}</option>
														{/each}
													</select>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#each c.fields as field (field.key)}
						{#if !(c.type === 'ORDER' && c.catalog.length && (field.key === 'product' || field.key === 'variant' || field.key === 'quantity'))}
							<div>
								<label class="label" for="pf-{field.key}">{field.label}{#if field.required}<span class="text-danger"> *</span>{/if}</label>
								{#if isTextarea(field.key)}
									<textarea id="pf-{field.key}" rows="3" bind:value={values[field.key]} required={field.required} class="input"></textarea>
								{:else if field.key === 'deliveryMethod'}
									<select id="pf-{field.key}" bind:value={values[field.key]} required={field.required} class="input">
										<option value="">Choose…</option>
										<option value="DELIVERY">Delivery</option>
										<option value="PICKUP">Pickup</option>
									</select>
								{:else}
									<input
										id="pf-{field.key}"
										type={isDate(field.key) ? 'date' : isNumber(field.key) ? 'number' : field.key === 'email' ? 'email' : 'text'}
										bind:value={values[field.key]}
										required={field.required}
										class="input"
									/>
								{/if}
							</div>
						{/if}
					{/each}

					{#if errorMessage}<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{errorMessage}</p>{/if}

					<button type="submit" disabled={submitting} class="btn w-full font-semibold text-white transition disabled:opacity-50" style="background: var(--accent)">
						{submitting ? 'Sending…' : (c.ctaText ?? 'Submit')}
					</button>
				</form>
			{/if}
		</div>

		{#if !data.embedded}
			<p class="mt-4 text-center text-[10px] text-slate-400">Powered by Makutano Connect</p>
		{/if}
	</div>
</div>
