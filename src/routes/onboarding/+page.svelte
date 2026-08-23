<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let mainUse = $state('BOTH');
	let selectedPlan = $state(
		form?.planId || data.plans.find((p) => p.code === data.defaultPlanCode)?.id || data.plans[0]?.id || ''
	);

	const money = (amount: number, currency: string) =>
		amount === 0 ? 'Free' : new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
</script>

<svelte:head><title>Set up your business · Makutano Connect</title></svelte:head>

<AuthShell
	title="Tell us about your business"
	subtitle="This shapes your workspace. Everything here can be changed later in Settings."
	width="lg"
>
	<form
		method="POST"
		class="space-y-4"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		{#if form?.message}
			<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
		{/if}

		<div class="card p-6">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label class="label" for="businessName">Business name</label>
					<input id="businessName" name="businessName" required value={form?.businessName ?? ''} class="input" placeholder="Goldfinch Safaris" />
				</div>

				<div>
					<label class="label" for="industry">Industry</label>
					<select id="industry" name="industry" required class="input" value={form?.industry ?? ''}>
						<option value="" disabled>Choose one…</option>
						{#each data.industries as industry (industry.value)}
							<option value={industry.value}>{industry.label}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="label" for="country">Country</label>
					<select id="country" name="country" required class="input" value={form?.country ?? 'TZ'}>
						{#each data.countries as country (country.code)}
							<option value={country.code}>{country.name}</option>
						{/each}
					</select>
				</div>

				<div>
					<label class="label" for="businessPhone">Business phone</label>
					<input id="businessPhone" name="businessPhone" required value={form?.businessPhone ?? ''} class="input" placeholder="+255 712 345 678" />
				</div>

				<div>
					<label class="label" for="websiteUrl">Website <span class="font-normal text-slate-400">(optional)</span></label>
					<input id="websiteUrl" name="websiteUrl" type="url" value={form?.websiteUrl ?? ''} class="input" placeholder="https://yourbusiness.com" />
				</div>
			</div>
		</div>

		<div class="card p-6">
			<h2 class="mb-1 text-sm font-semibold text-slate-700">What will you mainly use Connect for?</h2>
			<p class="mb-3 text-[11px] text-slate-400">This shapes your menus and dashboard — you can change it anytime in Settings.</p>
			<div class="grid gap-2 sm:grid-cols-3">
				{#each [{ value: 'ORDERS', label: 'Simple orders', hint: 'Customers order what you sell — fish, food, products' }, { value: 'BOOKINGS', label: 'Bookings & enquiries', hint: 'Tours, stays, appointments, quotes' }, { value: 'BOTH', label: 'A combination', hint: 'A bit of everything' }] as opt (opt.value)}
					<label class="cursor-pointer rounded-panel border p-3 transition {mainUse === opt.value ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-slate-200 hover:border-slate-300'}">
						<input type="radio" name="mainUse" value={opt.value} bind:group={mainUse} class="sr-only" />
						<span class="block text-sm font-semibold text-slate-700">{opt.label}</span>
						<span class="mt-0.5 block text-[11px] text-slate-500">{opt.hint}</span>
					</label>
				{/each}
			</div>
		</div>

		{#if data.plans.length}
			<div class="card p-6">
				<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
					<h2 class="text-sm font-semibold text-slate-700">Choose a plan</h2>
					{#if data.trialDays > 0}
						<span class="badge bg-success/10 text-success">{data.trialDays}-day free trial · no card needed</span>
					{/if}
				</div>

				<div class="grid gap-3 sm:grid-cols-3">
					{#each data.plans as plan (plan.id)}
						<label
							class="cursor-pointer rounded-panel border p-4 transition {selectedPlan === plan.id
								? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500'
								: 'border-slate-200 hover:border-slate-300'}"
						>
							<input type="radio" name="planId" value={plan.id} bind:group={selectedPlan} class="sr-only" />
							<div class="flex items-baseline justify-between">
								<span class="text-sm font-semibold text-slate-700">{plan.name}</span>
								{#if selectedPlan === plan.id}
									<span class="badge bg-brand-500 text-white">Selected</span>
								{/if}
							</div>
							<p class="mt-1 text-lg font-bold text-slate-800">
								{money(plan.priceMonthly, plan.currency)}
								{#if plan.priceMonthly > 0}<span class="text-xs font-normal text-slate-400">/month</span>{/if}
							</p>
							<ul class="mt-2 space-y-1">
								{#each plan.highlights as highlight (highlight)}
									<li class="flex items-start gap-1.5 text-[11px] text-slate-500">
										<span class="mt-0.5 text-success">✓</span>{highlight}
									</li>
								{/each}
							</ul>
						</label>
					{/each}
				</div>

				<p class="mt-3 text-[11px] text-slate-400">
					{#if data.trialDays > 0}
						You will not be charged during the trial, and we will ask before anything changes.
					{:else}
						Your workspace is created straight away and activated once billing is confirmed.
					{/if}
				</p>
			</div>
		{/if}

		<button type="submit" class="btn-primary w-full" disabled={submitting}>
			{submitting ? 'Creating your workspace…' : 'Create my workspace'}
		</button>
	</form>

	{#snippet footer()}
		Signed in as {data.fullName || 'you'} · <a href="/logout" class="text-brand-600 hover:underline">Sign out</a>
	{/snippet}
</AuthShell>
