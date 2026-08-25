<script lang="ts">
	// Order Links: create an offer, share the link anywhere, orders flow in.
	// One offer → one link → simple form → one order. Deliberately not a store.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import Money from '$components/Money.svelte';
	let { data, form } = $props();

	let showForm = $state(false);
	let editing = $state<string | null>(null);
	let qrFor = $state<string | null>(null);
	let qrDataUrl = $state<string | null>(null);
	let copied = $state<string | null>(null);

	const editLink = $derived(data.links.find((l) => l.id === editing) ?? null);
	const publicUrl = (publicId: string, tag?: string) => `${data.origin}/o/${publicId}${tag ? `?s=${tag}` : ''}`;

	const STATUS_TONE: Record<string, string> = {
		ACTIVE: 'bg-success/10 text-success',
		DRAFT: 'bg-slate-100 text-slate-500',
		PAUSED: 'bg-warning/10 text-warning',
		ARCHIVED: 'bg-slate-100 text-slate-400'
	};

	async function copyLink(publicId: string) {
		await navigator.clipboard.writeText(publicUrl(publicId));
		copied = publicId;
		setTimeout(() => (copied = null), 1500);
	}

	function whatsappShare(link: (typeof data.links)[number]) {
		const price = `${link.currency} ${Number(link.unitPrice).toLocaleString()} / ${link.unit}`;
		const text = `${link.title}\n${price}\n\nPlace your order:\n${publicUrl(link.publicId)}`;
		window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
	}

	async function showQr(link: (typeof data.links)[number]) {
		const QRCode = (await import('qrcode')).default;
		qrDataUrl = await QRCode.toDataURL(publicUrl(link.publicId), { width: 480, margin: 2 });
		qrFor = link.id;
	}

	const isExpired = (l: (typeof data.links)[number]) => l.status === 'ACTIVE' && l.deadline && new Date(l.deadline) < new Date();
	const conversion = (l: (typeof data.links)[number]) =>
		l.viewCount >= 10 && l.stats.orders > 0 ? `${((l.stats.orders / l.viewCount) * 100).toFixed(1)}%` : null;

	// datetime-local wants local "YYYY-MM-DDTHH:mm"
	const toLocal = (v: string | Date | null) => {
		if (!v) return '';
		const d = new Date(v);
		return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	};
</script>

<svelte:head><title>Order Links · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Saved" />

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Order Links" />
{:else}
<div class="space-y-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<a href="/app/orders" class="text-xs text-slate-500 hover:underline">← Orders</a>
			<h1 class="text-base font-semibold text-slate-900">Order Links</h1>
			<p class="text-xs text-slate-400">One offer → one link. Share it in WhatsApp groups, status, Instagram — orders arrive structured.</p>
		</div>
		<div class="flex items-center gap-2">
			<a href="?archived={data.includeArchived ? '0' : '1'}" class="text-xs text-slate-500 hover:underline">{data.includeArchived ? 'Hide archived' : 'Show archived'}</a>
			{#if data.canWrite}
				<button class="btn-primary" onclick={() => { showForm = !showForm; editing = null; }}>{showForm ? 'Close' : 'Create Order Link'}</button>
			{/if}
		</div>
	</div>

	{#if (showForm || editing) && data.canWrite}
		{@const l = editLink}
		<form
			method="POST"
			action={l ? '?/update' : '?/create'}
			use:enhance={() => async ({ update, result }) => { await update({ reset: !l }); if (result.type === 'success') { showForm = false; editing = null; } }}
			class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
		>
			{#if l}<input type="hidden" name="id" value={l.id} /><input type="hidden" name="catalogItemId" value={l.catalogItemId ?? ''} />{/if}
			<div class="sm:col-span-2"><label class="label" for="ol-title">What are you selling?</label><input id="ol-title" name="title" required value={l?.title ?? ''} placeholder="Fresh Fish" class="input" /></div>
			<div>
				<label class="label" for="ol-unit">Unit</label>
				<select id="ol-unit" name="unit" class="input">
					{#each data.unitPresets as u (u)}<option value={u} selected={l?.unit === u}>{u}</option>{/each}
					<option value="CUSTOM" selected={!!l && !data.unitPresets.includes(l.unit as never)}>Custom…</option>
				</select>
			</div>
			<div><label class="label" for="ol-custom-unit">Custom unit <span class="font-normal text-slate-400">(if chosen)</span></label><input id="ol-custom-unit" name="customUnit" value={l && !data.unitPresets.includes(l.unit as never) ? l.unit : ''} placeholder="Crate" class="input" /></div>
			<div><label class="label" for="ol-price">Price per unit</label><input id="ol-price" name="unitPrice" required inputmode="decimal" value={l ? String(l.unitPrice) : ''} placeholder="14000" class="input" /></div>
			<div><label class="label" for="ol-currency">Currency</label><input id="ol-currency" name="currency" maxlength="3" value={l?.currency ?? data.tenant.currency} class="input font-mono uppercase" /></div>
			<div><label class="label" for="ol-min">Minimum qty</label><input id="ol-min" name="minQuantity" inputmode="numeric" value={l?.minQuantity ?? 1} class="input" /></div>
			<div><label class="label" for="ol-max">Maximum qty <span class="font-normal text-slate-400">(optional)</span></label><input id="ol-max" name="maxQuantity" inputmode="numeric" value={l?.maxQuantity ?? ''} class="input" /></div>
			<div class="sm:col-span-2"><label class="label" for="ol-desc">Description <span class="font-normal text-slate-400">(optional)</span></label><input id="ol-desc" name="description" value={l?.description ?? ''} placeholder="Fresh fish available for Saturday delivery." class="input" /></div>
			<div class="sm:col-span-2"><label class="label" for="ol-image">Image URL <span class="font-normal text-slate-400">(optional)</span></label><input id="ol-image" name="imageUrl" value={l?.imageUrl ?? ''} placeholder="https://…" class="input" /></div>
			<div><label class="label" for="ol-deadline">Orders close <span class="font-normal text-slate-400">(optional)</span></label><input id="ol-deadline" name="deadline" type="datetime-local" value={toLocal(l?.deadline ?? null)} class="input" /></div>
			<div><label class="label" for="ol-delivery-date">Delivery date <span class="font-normal text-slate-400">(optional)</span></label><input id="ol-delivery-date" name="deliveryDate" type="datetime-local" value={toLocal(l?.deliveryDate ?? null)} class="input" /></div>
			<div><label class="label" for="ol-capacity">Total capacity <span class="font-normal text-slate-400">(optional, e.g. 200)</span></label><input id="ol-capacity" name="capacityTotal" inputmode="numeric" value={l?.capacityTotal ?? ''} class="input" /></div>
			<div><label class="label" for="ol-batch">Add orders to batch <span class="font-normal text-slate-400">(optional)</span></label>
				<select id="ol-batch" name="batchId" class="input">
					<option value="">No batch</option>
					{#each data.batches as b (b.id)}<option value={b.id} selected={l?.batchId === b.id}>{b.name}</option>{/each}
				</select>
			</div>

			<div class="flex flex-wrap items-center gap-4 sm:col-span-2">
				<label class="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="pickupEnabled" checked={l?.pickupEnabled ?? true} class="rounded border-slate-300" /> Pickup</label>
				<label class="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="deliveryEnabled" checked={l?.deliveryEnabled ?? true} class="rounded border-slate-300" /> Delivery</label>
				<div class="flex items-center gap-2"><span class="text-xs text-slate-500">Delivery fee</span><input name="deliveryFee" inputmode="decimal" value={l ? String(l.deliveryFee) : '0'} class="input w-28 py-1.5" /></div>
			</div>

			<div class="sm:col-span-2">
				<span class="label">Customer fields</span>
				<div class="grid grid-cols-3 gap-2">
					{#each [{ k: 'f_deliveryLocation', label: 'Delivery location', v: l?.fieldConfig?.deliveryLocation ?? 'OPTIONAL' }, { k: 'f_note', label: 'Note', v: l?.fieldConfig?.note ?? 'OPTIONAL' }, { k: 'f_email', label: 'Email', v: l?.fieldConfig?.email ?? 'HIDDEN' }] as f (f.k)}
						<div>
							<span class="mb-1 block text-[11px] text-slate-500">{f.label}</span>
							<select name={f.k} class="input py-1.5 text-xs">
								{#each ['OPTIONAL', 'REQUIRED', 'HIDDEN'] as m (m)}<option value={m} selected={f.v === m}>{m.toLowerCase()}</option>{/each}
							</select>
						</div>
					{/each}
				</div>
			</div>

			<div class="sm:col-span-2">
				<span class="label">Payment</span>
				<label class="flex items-start gap-2 text-sm text-slate-600">
					<input type="radio" name="paymentTiming" value="AFTER_CONFIRMATION" checked={(l?.paymentTiming ?? 'AFTER_CONFIRMATION') === 'AFTER_CONFIRMATION'} class="mt-1" />
					<span><b>Request payment after you confirm</b> <span class="badge bg-brand-50 text-brand-600">recommended</span><br /><span class="text-xs text-slate-400">You check availability first, then send the payment request.</span></span>
				</label>
				<label class="mt-2 flex items-start gap-2 text-sm text-slate-600">
					<input type="radio" name="paymentTiming" value="IMMEDIATE" checked={l?.paymentTiming === 'IMMEDIATE'} class="mt-1" />
					<span><b>Request payment immediately</b><br /><span class="text-xs text-slate-400">A payment request with your payment details goes out as soon as the order arrives.</span></span>
				</label>
			</div>

			<div class="sm:col-span-2"><label class="label" for="ol-tags">Share tags <span class="font-normal text-slate-400">(optional, comma-separated — each gets its own trackable link)</span></label><input id="ol-tags" name="shareTags" value={(l?.shareTags as Array<{ label: string }> | undefined)?.map((t) => t.label).join(', ') ?? ''} placeholder="WhatsApp Group A, Status, Instagram" class="input" /></div>

			<div class="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
				<button class="btn-primary">{l ? 'Save changes' : 'Create link'}</button>
				{#if !l}<label class="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="activate" checked class="rounded border-slate-300" /> Go live immediately</label>{/if}
			</div>
		</form>
	{/if}

	{#each data.links as link (link.id)}
		<section class="card p-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-[15px] font-semibold text-slate-800">{link.title}</h2>
						<span class="badge {STATUS_TONE[link.status]} text-xs">{isExpired(link) ? 'EXPIRED' : link.status.toLowerCase()}</span>
						{#if link.paymentTiming === 'IMMEDIATE'}<span class="badge bg-purple/10 text-purple text-xs">pay now</span>{/if}
					</div>
					<p class="mt-0.5 text-sm text-slate-500"><Money amount={String(link.unitPrice)} currency={link.currency} /> / {link.unit}{#if link.deadline}<span class="text-xs text-slate-400"> · closes {new Date(link.deadline).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>{/if}</p>
				</div>
				<div class="flex flex-wrap items-center gap-4 text-center">
					<div><div class="text-lg font-bold tabular-nums text-slate-800">{link.stats.orders}</div><div class="text-[10px] uppercase tracking-wide text-slate-400">orders</div></div>
					<div><div class="text-lg font-bold tabular-nums text-slate-800">{link.stats.quantity}</div><div class="text-[10px] uppercase tracking-wide text-slate-400">{link.unit}</div></div>
					<div><div class="text-lg font-bold tabular-nums text-slate-800"><Money amount={String(link.stats.expected)} currency={link.currency} /></div><div class="text-[10px] uppercase tracking-wide text-slate-400">expected</div></div>
					<div><div class="text-lg font-bold tabular-nums text-slate-500">{link.viewCount}</div><div class="text-[10px] uppercase tracking-wide text-slate-400">views{#if conversion(link)}<span class="text-success"> · {conversion(link)}</span>{/if}</div></div>
				</div>
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
				<button class="btn-secondary !px-2.5 !py-1.5 text-xs" onclick={() => copyLink(link.publicId)}>{copied === link.publicId ? '✓ Copied' : 'Copy Link'}</button>
				<button class="btn-secondary !px-2.5 !py-1.5 text-xs" onclick={() => whatsappShare(link)}>Share to WhatsApp</button>
				<button class="btn-secondary !px-2.5 !py-1.5 text-xs" onclick={() => showQr(link)}>QR Code</button>
				<a href={publicUrl(link.publicId)} target="_blank" rel="noopener" class="btn-secondary !px-2.5 !py-1.5 text-xs">View</a>
				<a href="/app/orders?orderLinkId={link.id}" class="btn-secondary !px-2.5 !py-1.5 text-xs">Orders</a>
				{#if data.canWrite && link.status !== 'ARCHIVED'}
					<button class="btn-secondary !px-2.5 !py-1.5 text-xs" onclick={() => { editing = link.id; showForm = false; }}>Edit</button>
					<form method="POST" action="?/setStatus" use:enhance class="inline">
						<input type="hidden" name="id" value={link.id} />
						<input type="hidden" name="status" value={link.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'} />
						<button class="btn-secondary !px-2.5 !py-1.5 text-xs">{link.status === 'ACTIVE' ? 'Pause' : 'Activate'}</button>
					</form>
					<form method="POST" action="?/duplicate" use:enhance class="inline">
						<input type="hidden" name="id" value={link.id} />
						<button class="btn-secondary !px-2.5 !py-1.5 text-xs">Duplicate</button>
					</form>
					{#if data.canArchive}
						<form method="POST" action="?/setStatus" use:enhance class="inline">
							<input type="hidden" name="id" value={link.id} />
							<input type="hidden" name="status" value="ARCHIVED" />
							<button class="!px-2 !py-1.5 text-xs text-slate-400 hover:text-danger hover:underline">Archive</button>
						</form>
					{/if}
				{/if}
			</div>

			{#if (link.shareTags as Array<{ key: string; label: string }>).length}
				<div class="mt-2 space-y-1">
					{#each link.shareTags as Array<{ key: string; label: string }> as tag (tag.key)}
						<div class="flex items-center gap-2 text-[11px]">
							<span class="badge bg-slate-100 text-slate-500">{tag.label}</span>
							<code class="truncate text-slate-400">{publicUrl(link.publicId, tag.key)}</code>
							<button class="shrink-0 text-brand-600 hover:underline" onclick={() => navigator.clipboard.writeText(publicUrl(link.publicId, tag.key))}>copy</button>
							{#if data.detailId === link.id}
								{@const row = data.breakdown.find((b) => b.tag === tag.key)}
								<span class="ml-auto tabular-nums text-slate-500">{row ? `${row.orders} orders · ${row.quantity} ${link.unit}` : 'no orders yet'}</span>
							{/if}
						</div>
					{/each}
					{#if data.detailId !== link.id}
						<a href="?detail={link.id}" class="text-[11px] text-brand-600 hover:underline">Show orders per share tag →</a>
					{/if}
				</div>
			{/if}
		</section>
	{:else}
		<div class="card p-10 text-center">
			<h2 class="text-sm font-semibold text-slate-700">No order links yet</h2>
			<p class="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
				Create one in under a minute — "Fresh Fish, TZS 14,000/KG, Saturday delivery" — then share the link in your
				WhatsApp group. Every submission becomes a structured order with the customer attached. No website needed.
			</p>
		</div>
	{/each}
</div>

{/if}

<!-- QR overlay -->
{#if qrFor && qrDataUrl}
	{@const link = data.links.find((l) => l.id === qrFor)}
	<div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
		<button class="absolute inset-0 cursor-default" onclick={() => (qrFor = null)} aria-label="Close" tabindex="-1"></button>
		<div class="relative z-10 w-full max-w-xs rounded-panel bg-white p-5 text-center shadow-lg">
			<h3 class="text-sm font-semibold text-slate-800">{link?.title}</h3>
			<img src={qrDataUrl} alt="QR code for the order link" class="mx-auto mt-3 w-56" />
			<a href={qrDataUrl} download="{link?.title ?? 'order-link'}-qr.png" class="btn-primary mt-3 w-full">Download QR</a>
			<button class="mt-2 w-full text-xs text-slate-400 hover:underline" onclick={() => (qrFor = null)}>Close</button>
		</div>
	</div>
{/if}
