<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let declining = $state(false);

	const q = $derived(data.quotation);
	const money = (v: string | null) => `${q.currency} ${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
	const day = (d: string | Date | null) =>
		d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

	// One line that says where this stands, so nobody has to infer it from which
	// buttons happen to be showing.
	const standing = $derived(
		form?.accepted || ['ACCEPTED', 'CONVERTED'].includes(q.status)
			? { tone: 'ok', text: 'You accepted this quotation. We will be in touch to confirm the details.' }
			: form?.declined || q.status === 'DECLINED'
				? { tone: 'muted', text: 'You declined this quotation. Message us any time if you change your mind.' }
				: q.expired
					? { tone: 'warn', text: `This quotation expired on ${day(q.validUntil)}. Ask us for an updated one.` }
					: null
	);
</script>

<svelte:head><title>{q.reference} · {q.business.name}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8 sm:py-12">
	<header class="mb-6">
		<p class="text-xs font-semibold uppercase tracking-wide text-slate-400">{q.business.name}</p>
		<h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-900">{q.title || 'Your quotation'}</h1>
		<p class="mt-1 text-sm text-slate-500">
			{q.reference}{#if q.validUntil && !q.expired} · valid until {day(q.validUntil)}{/if}
		</p>
	</header>

	{#if standing}
		<div
			class="mb-5 rounded-xl px-4 py-3 text-sm {standing.tone === 'ok'
				? 'border border-success/30 bg-success/5 text-success'
				: standing.tone === 'warn'
					? 'border border-warning/30 bg-warning/5 text-warning'
					: 'border border-slate-200 bg-slate-50 text-slate-600'}"
		>
			{standing.text}
		</div>
	{/if}

	{#if form?.error}
		<div class="mb-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{form.error}</div>
	{/if}

	<div class="card overflow-hidden">
		<ul class="divide-y divide-slate-100">
			{#each q.items as item, i (i)}
				<li class="flex items-start gap-4 px-4 py-3">
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium text-slate-900">{item.title}</div>
						{#if item.description}
							<p class="mt-0.5 text-xs text-slate-500">{item.description}</p>
						{/if}
						{#if item.quantity && item.quantity > 1}
							<p class="mt-0.5 text-xs text-slate-400">{item.quantity} × {money(item.unitPrice)}</p>
						{/if}
					</div>
					<div class="shrink-0 text-sm font-medium text-slate-700">{money(item.total ?? item.unitPrice)}</div>
				</li>
			{/each}
		</ul>
		<div class="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
			<span class="text-sm font-semibold text-slate-700">Total</span>
			<span class="text-lg font-bold text-slate-900">{money(q.total)}</span>
		</div>
	</div>

	{#if q.decidable && !form?.accepted && !form?.declined}
		<div class="mt-6 space-y-3">
			<form method="POST" action="?/accept" use:enhance>
				<button class="btn-primary w-full py-3 text-base">Accept this quotation</button>
			</form>

			{#if !declining}
				<button type="button" class="btn-ghost w-full" onclick={() => (declining = true)}>
					This is not for me
				</button>
			{:else}
				<form method="POST" action="?/decline" use:enhance class="card space-y-3 p-4">
					<label class="block">
						<span class="label">Anything we could have done better? <span class="text-slate-400">(optional)</span></span>
						<input name="reason" placeholder="Too expensive, dates changed…" class="input w-full" />
					</label>
					<div class="flex gap-2">
						<button class="btn-primary">Send</button>
						<button type="button" class="btn-ghost" onclick={() => (declining = false)}>Cancel</button>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	<p class="mt-8 text-center text-xs text-slate-400">
		Sent by {q.business.name}. Reply on WhatsApp if you have any questions.
	</p>
</div>
