<script lang="ts">
	import { WORKSPACE_OPTIONS } from '$lib/workspace';
	import FormToast from '$components/FormToast.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();
	let showMethodForm = $state(false);
	let methodKind = $state<'MOBILE' | 'BANK' | 'ONLINE'>('MOBILE');
	const canWrite = $derived(data.permissions?.includes('tenant:write'));

</script>

<svelte:head><title>Settings · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Settings saved" />

<div class="mx-auto w-full max-w-5xl space-y-3">
	<h1 class="text-base font-semibold text-slate-900">Settings</h1>


	<form method="POST" action="?/save" use:enhance class="card">
		<header class="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">Business</header>
		<div class="grid gap-3 p-3 sm:grid-cols-2">
			<div><label class="label" for="name">Business name</label><input id="name" name="name" value={data.settings.name} class="input" disabled={!canWrite} /></div>

			<!-- The logo is NOT editable here.
			     It used to be a free-text "Logo URL" box, and that box was a lie: the
			     marketplace renders the uploaded brand logo, so an operator could change
			     this field and watch nothing happen on their storefront. One logo, set
			     in one place, shown here so this page still answers "what is my logo?" -->
			<div>
				<span class="label">Logo</span>
				<div class="flex items-center gap-3 rounded-panel border border-slate-200 bg-slate-50 px-3 py-2">
					{#if data.settings.logoUrl}
						<img src={data.settings.logoUrl} alt="" class="size-9 shrink-0 rounded-panel border border-slate-200 bg-white object-contain" />
					{:else}
						<span class="flex size-9 shrink-0 items-center justify-center rounded-panel border border-dashed border-slate-300 text-[11px] text-slate-400">—</span>
					{/if}
					<a href="/app/settings/profile" class="text-xs font-medium text-brand-600 hover:underline">
						{data.settings.logoUrl ? 'Change logo and banner' : 'Add your logo and banner'}
					</a>
				</div>
			</div>

			<div>
				<label class="label" for="timezone">Timezone</label>
				<select id="timezone" name="timezone" class="input" disabled={!canWrite}>
					{#each data.options.timezones as tz (tz)}
						<option value={tz} selected={data.settings.timezone === tz}>{tz.replace(/_/g, ' ')}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="currency">Currency</label>
				<select id="currency" name="currency" class="input" disabled={!canWrite}>
					{#each data.options.currencies as c (c.code)}
						<option value={c.code} selected={data.settings.currency === c.code}>{c.code} — {c.label}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="country">Country</label>
				<select id="country" name="country" class="input" disabled={!canWrite}>
					<option value="">Not set</option>
					{#each data.options.countries as c (c.code)}
						<option value={c.code} selected={data.settings.country === c.code}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="locale">Language</label>
				<select id="locale" name="locale" class="input" disabled={!canWrite}>
					{#each data.options.locales as l (l.code)}
						<option value={l.code} selected={data.settings.locale === l.code}>{l.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="label" for="bookingReferencePrefix">Booking reference prefix</label>
				<input id="bookingReferencePrefix" name="bookingReferencePrefix" value={data.settings.bookingReferencePrefix} class="input" disabled={!canWrite} />
				<p class="mt-1 text-[12.5px] text-slate-400">New references only, e.g. {data.settings.bookingReferencePrefix}-BK-2026-00001</p>
			</div>
			<div><label class="label" for="quotationPrefix">Quotation prefix</label><input id="quotationPrefix" name="quotationPrefix" value={data.settings.quotationPrefix} class="input" disabled={!canWrite} /></div>
			<div>
				<label class="label" for="capabilities">How do you use Connect?</label>
				<select id="capabilities" name="capabilities" class="input" disabled={!canWrite}>
					{#each WORKSPACE_OPTIONS as opt (opt.value)}
						<option value={opt.value} selected={data.settings.capabilities === opt.value}>{opt.label} — {opt.hint.toLowerCase()}</option>
					{/each}
				</select>
				<p class="mt-1 text-[12.5px] text-slate-400">
					This organises your menus and dashboard around your kind of work. It never adds or removes plan features.
				</p>
			</div>
		</div>
		{#if canWrite}<div class="border-t border-slate-200 p-3"><button class="btn-primary">Save settings</button></div>{/if}
	</form>

		<!-- How customers can pay — shown in payment request messages -->
	<section class="card p-4">
		<div class="mb-2 flex items-center justify-between">
			<h2 class="card-title">Payment methods</h2>
			{#if canWrite}<button class="btn-secondary !py-1.5 text-xs" onclick={() => (showMethodForm = !showMethodForm)}>Add method</button>{/if}
		</div>
		<p class="mb-3 text-[12.5px] text-slate-400">
			These details are included when you request a payment on WhatsApp. Display information only — never enter PINs or passwords.
		</p>

		{#if showMethodForm && canWrite}
				<form method="POST" action="?/savePaymentMethod" use:enhance={() => async ({ update }) => { await update({ reset: true }); showMethodForm = false; }} class="mb-3 grid gap-3 rounded-panel border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-3">
					<div>
						<label class="label" for="pm-kind">Type</label>
						<select id="pm-kind" name="kind" class="input" bind:value={methodKind}>
						<option value="MOBILE">Mobile payment / Lipa Namba</option>
						<option value="BANK">Bank transfer</option>
						<option value="ONLINE">Online payment link</option>
					</select>
					</div>
					<div><label class="label" for="pm-name">Display name</label><input id="pm-name" name="displayName" required class="input" placeholder={methodKind === 'BANK' ? 'Bank Transfer' : methodKind === 'ONLINE' ? 'Pay online' : 'M-Pesa Lipa Namba'} /></div>
					{#if methodKind === 'MOBILE'}
						<div><label class="label" for="pm-provider">Provider</label><input id="pm-provider" name="provider" class="input" placeholder="M-Pesa" /></div>
						<div><label class="label" for="pm-number">Lipa Namba / number</label><input id="pm-number" name="number" required class="input" placeholder="5123456" /></div>
						<div><label class="label" for="pm-account">Business name</label><input id="pm-account" name="accountName" class="input" placeholder="Goldfinch Adventures" /></div>
					{:else if methodKind === 'BANK'}
						<div><label class="label" for="pm-bank">Bank</label><input id="pm-bank" name="bank" class="input" placeholder="CRDB Bank" /></div>
						<div><label class="label" for="pm-account">Account name</label><input id="pm-account" name="accountName" class="input" placeholder="Goldfinch Adventures" /></div>
						<div><label class="label" for="pm-account-number">Account number</label><input id="pm-account-number" name="accountNumber" required class="input" placeholder="0150…" /></div>
						<div><label class="label" for="pm-branch">Branch <span class="font-normal text-slate-400">(optional)</span></label><input id="pm-branch" name="branch" class="input" /></div>
						<div><label class="label" for="pm-swift">SWIFT <span class="font-normal text-slate-400">(optional)</span></label><input id="pm-swift" name="swift" class="input" /></div>
					{:else}
						<div class="sm:col-span-2">
							<label class="label" for="pm-provider">Connected provider</label>
							{#if data.onlinePaymentProviders.length}
								<select id="pm-provider" name="provider" class="input">{#each data.onlinePaymentProviders as provider (provider.code)}<option value={provider.code}>{provider.code}</option>{/each}</select>
							{:else}
								<p class="rounded-panel bg-slate-50 px-3 py-2 text-xs text-slate-500">No online provider is connected. Connect will not accept a pasted success URL as proof of payment.</p>
							{/if}
							<p class="mt-1 text-[12.5px] text-slate-400">The provider generates a fresh secure URL for each payment request.</p>
						</div>
					{/if}
					<div class="sm:col-span-2"><label class="label" for="pm-instr">Extra instructions <span class="font-normal text-slate-400">(optional)</span></label><input id="pm-instr" name="instructions" class="input" placeholder="Send the confirmation SMS screenshot here" /></div>
					<div class="flex items-end gap-3">
						<label class="flex min-h-10 items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="enabled" checked /> Enabled</label>
						<button class="btn-primary ml-auto" disabled={methodKind === 'ONLINE' && data.onlinePaymentProviders.length === 0}>Save method</button>
					</div>
			</form>
		{/if}

		{#if data.settings.paymentMethods.length === 0}
				<p class="rounded-panel bg-slate-50 px-3 py-2 text-xs text-slate-500">No payment methods yet — add one before requesting payment.</p>
		{:else}
			<ul class="divide-y divide-slate-100">
				{#each data.settings.paymentMethods as m (m.key)}
					<li class="flex flex-wrap items-center gap-2 py-2 text-sm">
						<span class="badge bg-slate-100 text-slate-500">{m.kind === 'MOBILE' ? 'Mobile' : m.kind === 'BANK' ? 'Bank' : 'Online'}</span>
						<span class="font-medium text-slate-700">{m.displayName}</span>
						{#if m.bank}<span class="text-xs text-slate-500">{m.bank}</span>{/if}
						{#if m.number || m.accountNumber}<span class="font-mono text-xs text-slate-500">{m.accountNumber ?? m.number}</span>{/if}
						{#if m.accountName}<span class="text-xs text-slate-500">{m.accountName}</span>{/if}
						{#if !m.enabled}<span class="badge bg-slate-100 text-slate-400">Disabled</span>{/if}
						{#if canWrite}
							<form method="POST" action="?/removePaymentMethod" use:enhance class="ml-auto">
								<input type="hidden" name="key" value={m.key} />
								<button class="text-xs text-slate-400 hover:text-danger hover:underline">Remove</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!--
		Public profile has its own card because it was previously reachable only
		through a link labelled "Change logo and banner", which gives no hint that
		the contact details travellers use to answer a quotation live behind it.
		The owner of a live workspace looked for them here and did not find them.
	-->
	<section class="card">
		<header class="card-header">
			<h2 class="card-title">Public profile</h2>
			<a href="/app/settings/profile" class="btn-secondary !py-1.5 text-xs">Edit public profile</a>
		</header>
		<div class="p-3">
			<p class="text-xs text-slate-500">
				Your logo, banner, description and the contact details shown to travellers on Makutano
				Journeys — public email, public phone and website.
			</p>
			{#if data.publicContactMissing}
				<p class="mt-3 rounded-panel border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs leading-6 text-warning">
					<strong class="font-semibold">No public contact yet.</strong>
					A traveller who opens a quotation you sent has no way to reply to you from it. Add a public
					email or phone so they can accept it or ask for a change.
				</p>
			{/if}
		</div>
	</section>

<section class="card">
		<header class="card-header">
			<h2 class="card-title">Plan &amp; usage</h2>
			<span class="badge bg-brand-50 text-brand-600">{data.plan.name}</span>
		</header>
		<div class="space-y-3 p-4">
			{#each data.usage as row (row.label)}
				<div>
					<div class="flex justify-between text-xs">
						<span class="text-slate-600">{row.label}</span>
						<span class="tabular-nums text-slate-500">{row.used}{row.limit === null ? '' : ` / ${row.limit}`}</span>
					</div>
					{#if row.limit !== null}
						<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
							<div class="h-full rounded-full {row.percent >= 100 ? 'bg-danger' : row.percent >= 80 ? 'bg-warning' : 'bg-brand-500'}" style="width: {row.percent}%"></div>
						</div>
					{/if}
				</div>
			{/each}
			<p class="text-[12.5px] text-slate-400">Billing period {data.period} · times shown in {data.settings.timezone}</p>
		</div>
	</section>

	<section class="card">
		<header class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
			<h2 class="text-sm font-semibold text-slate-800">Team</h2>
			<a href="/app/crew" class="btn-primary !py-1.5 text-xs">Manage people</a>
		</header>
		<p class="px-3 py-3 text-xs text-slate-500">
			{data.members.length} member{data.members.length === 1 ? '' : 's'} — invite staff, set roles and control exactly what each person can see and do.
		</p>
	</section>
</div>
