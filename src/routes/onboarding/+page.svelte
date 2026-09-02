<script lang="ts">
	import { enhance } from '$lib/forms';
	import { tick, untrack } from 'svelte';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	const initial = untrack(() => ({
		step: form?.message && form?.primaryGoal ? 2 : 1,
		primaryGoal: form?.primaryGoal ?? '',
		industry: form?.industry ?? '',
		systemSource: form?.systemSource ?? '',
		businessName: form?.businessName ?? '',
		country: form?.country ?? 'TZ',
		businessPhone: form?.businessPhone ?? '',
		websiteUrl: form?.websiteUrl ?? '',
		planId: form?.planId || data.plans.find((p) => p.code === data.defaultPlanCode)?.id || data.plans[0]?.id || ''
	}));
	let submitting = $state(false);
	let step = $state(initial.step);
	let primaryGoal = $state(initial.primaryGoal);
	// Fixed: signup creates tour and travel operators and nothing else.
	let industry = $state(initial.industry || 'TRAVEL_TOURISM');
	let systemSource = $state(initial.systemSource);
	let businessName = $state(initial.businessName);
	let country = $state(initial.country);
	let businessPhone = $state(initial.businessPhone);
	let websiteUrl = $state(initial.websiteUrl);
	let selectedPlan = $state(initial.planId);

	const goals = [
		{ value: 'BOOKINGS', label: 'Bookings & enquiries', hint: 'Reservations, trips, stays and appointments', icon: 'M4 5h12v11H4V5Zm3-2v4m6-4v4M7 10h6' },
		{ value: 'SERVICE', label: 'Customer service', hint: 'Enquiries, quotations and client follow-up', icon: 'M3 4h14v9H7l-4 3V4Zm4 4h6m-6 3h4' },
		{ value: 'PAYMENTS', label: 'Payments & follow-up', hint: 'Payment requests, verification and notifications', icon: 'M3 6h14v9H3V6Zm0 3h14m-11 3h3' }
	] as const;

	const systemOptions = [
		{ value: 'WEBSITE_CMS', label: 'My website / CMS', hint: 'Keep it as the source of truth' },
		{ value: 'BOOKING_SYSTEM', label: 'Booking or order system', hint: 'Connect through APIs or webhooks' },
		{ value: 'OTHER_SYSTEM', label: 'Another business system', hint: 'Connect the tools you already operate' },
		{ value: 'CONNECT_MANUAL', label: 'I want to manage it manually', hint: 'Start directly inside Connect' }
	] as const;

	const selectedGoal = $derived(goals.find((goal) => goal.value === primaryGoal));
	const selectedSource = $derived(systemOptions.find((item) => item.value === systemSource));
	const recommendedPlanCode = $derived(data.plans.find((plan) => plan.code === 'BUSINESS')?.code ?? data.defaultPlanCode);
	const needsSystemSource = $derived(industry === 'TRAVEL_TOURISM');
	const sourceQuestion = 'Where do you currently manage your tours?';
	const stepOneReady = $derived(Boolean(primaryGoal));
	const stepTwoReady = $derived(
		Boolean(businessName.trim() && country && businessPhone.trim() && (!needsSystemSource || systemSource))
	);

	const money = (amount: number, currency: string) =>
		amount === 0 ? 'Free' : new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);

	function go(next: number) {
		step = Math.min(3, Math.max(1, next));
		window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	}

	// All three steps live in one form, and the inactive ones are display:none. A
	// browser will not submit a form holding an invalid control it cannot focus — it
	// refuses in silence, which is exactly what a dead button feels like. So the form
	// carries `novalidate` and we do the checking here, where we can always show the
	// field that is actually wrong.
	let formEl: HTMLFormElement | null = $state(null);

	const fieldsOf = (n: number) =>
		[...(formEl?.querySelectorAll<HTMLInputElement>(`[data-step="${n}"] input, [data-step="${n}"] select`) ?? [])];

	function firstInvalid(fields: HTMLInputElement[]): HTMLInputElement | null {
		return fields.find((el) => !el.checkValidity()) ?? null;
	}

	/** Move forward only once this step's own fields are good, and say why if not. */
	function forward(next: number) {
		const bad = firstInvalid(fieldsOf(step));
		if (bad) {
			bad.reportValidity();
			return;
		}
		go(next);
	}

	/** A website typed as "example.com" is a valid intention and an invalid URL. */
	function normalizeWebsite() {
		const value = websiteUrl.trim();
		websiteUrl = value && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
	}
</script>

<svelte:head><title>Set up your workspace · Makutano Connect</title></svelte:head>

<AuthShell
	title="Set up your operation."
	subtitle="A few focused choices shape what your team sees. They never replace plan permissions, and you can change them later."
	width="xl"
>
	<form
		method="POST"
		novalidate
		bind:this={formEl}
		class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_24px_70px_rgba(50,58,70,0.10)] lg:grid lg:grid-cols-[220px_minmax(0,1fr)]"
		use:enhance={({ cancel }) => {
			const bad = firstInvalid([...(formEl?.querySelectorAll<HTMLInputElement>('input, select') ?? [])]);
			if (bad) {
				// Take the person to the step the bad field is on, then let the browser
				// explain it. Never a click that does nothing.
				go(Number(bad.closest('[data-step]')?.getAttribute('data-step') ?? step));
				tick().then(() => bad.reportValidity());
				cancel();
				return;
			}
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<aside class="border-b border-slate-200 bg-[#f8faff] p-5 lg:border-r lg:border-b-0 lg:p-6">
			<p class="text-[10px] font-bold tracking-[0.16em] text-brand-600 uppercase">Workspace setup</p>
			<div class="mt-4 grid grid-cols-3 gap-2 lg:block lg:space-y-2">
				{#each [{ n: 1, title: 'Shape', detail: 'Goals & business' }, { n: 2, title: 'Profile', detail: 'Details & systems' }, { n: 3, title: 'Plan', detail: 'Trial & review' }] as item (item.n)}
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition {step === item.n ? 'bg-white shadow-sm ring-1 ring-slate-200' : item.n < step ? 'text-slate-600 hover:bg-white/70' : 'text-slate-400'}"
						onclick={() => item.n < step && go(item.n)}
						disabled={item.n > step}
					>
						<span class="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold {step === item.n ? 'bg-brand-500 text-white' : item.n < step ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'}">{item.n < step ? '✓' : item.n}</span>
						<span class="hidden lg:block"><span class="block text-xs font-semibold text-slate-700">{item.title}</span><span class="mt-0.5 block text-[10px] text-slate-400">{item.detail}</span></span>
					</button>
				{/each}
			</div>

			<div class="mt-8 hidden rounded-xl border border-brand-100 bg-brand-50/70 p-3 lg:block">
				<p class="text-[11px] font-semibold text-brand-800">Keep your systems.</p>
				<p class="mt-1 text-[10px] leading-4 text-brand-700/75">Connect will adapt around the tools and workflows you already use.</p>
			</div>
		</aside>

		<div class="min-w-0 p-5 sm:p-7 lg:p-9">
			{#if form?.message}
				<p class="mb-5 rounded-lg border border-danger/15 bg-danger/5 px-3 py-2.5 text-xs text-danger" role="alert">{form.message}</p>
			{/if}

			<section data-step="1" class:hidden={step !== 1} aria-labelledby="shape-title">
				<div class="mb-7"><p class="text-[10px] font-bold tracking-[0.16em] text-brand-600 uppercase">Step 1 of 3</p><h2 id="shape-title" class="mt-2 text-xl font-bold tracking-tight text-slate-900">What will you mainly use Connect for?</h2><p class="mt-1.5 text-xs leading-5 text-slate-500">This controls the everyday navigation and dashboard—not what your plan allows.</p></div>

				<div class="grid gap-2.5 sm:grid-cols-2">
					{#each goals as goal (goal.value)}
						<label class="group cursor-pointer rounded-xl border p-4 transition {primaryGoal === goal.value ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'}">
							<input type="radio" name="primaryGoal" value={goal.value} bind:group={primaryGoal} class="sr-only" />
							<span class="flex items-start gap-3"><span class="flex size-9 shrink-0 items-center justify-center rounded-lg {primaryGoal === goal.value ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-white'}"><svg class="size-4.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d={goal.icon} /></svg></span><span><span class="block text-sm font-semibold text-slate-800">{goal.label}</span><span class="mt-1 block text-[11px] leading-4 text-slate-500">{goal.hint}</span></span></span>
						</label>
					{/each}
				</div>

				<!--
					The industry question is gone: there is one answer.

					Makutano is for Tanzanian tour and travel operators, and asking a
					question with a single option is a step that only costs the operator
					time. The value still posts, and the server allowlists it — hiding
					options in markup restricts nothing on its own.
				-->
				<input type="hidden" name="industry" value={industry} />
				<p class="mt-6 border-t border-slate-100 pt-6 text-xs leading-relaxed text-slate-500">
					Makutano Connect is built for tour and travel operators — listing trips on Makutano
					Journeys and running the enquiries, quotations and bookings that follow.
				</p>

				<div class="mt-8 flex justify-end"><button type="button" class="btn-primary min-h-11 !rounded-lg !px-6" disabled={!stepOneReady} onclick={() => forward(2)}>Continue →</button></div>
			</section>

			<section data-step="2" class:hidden={step !== 2} aria-labelledby="profile-title">
				<div class="mb-7"><p class="text-[10px] font-bold tracking-[0.16em] text-brand-600 uppercase">Step 2 of 3</p><h2 id="profile-title" class="mt-2 text-xl font-bold tracking-tight text-slate-900">Tell us about the operation.</h2><p class="mt-1.5 text-xs leading-5 text-slate-500">Only the details Connect needs to create a credible workspace.</p></div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="sm:col-span-2"><label class="label" for="businessName">Business name</label><input id="businessName" name="businessName" required bind:value={businessName} class="input min-h-11 !rounded-lg" placeholder="Goldfinch Adventures" /></div>
					<p class="col-span-full -mb-1 text-[12.5px] leading-5 text-slate-400">
						Only your business name is needed to get started. Anything you skip here
						can be filled in later under <span class="font-medium text-slate-500">Settings → Business profile</span>.
					</p>
					<div><label class="label" for="country">Country <span class="text-slate-400 font-normal">· optional</span></label><select id="country" name="country" class="input min-h-11 !rounded-lg" bind:value={country}>{#each data.countries as item (item.code)}<option value={item.code}>{item.name}</option>{/each}</select></div>
					<div><label class="label" for="businessPhone">Business phone <span class="text-slate-400 font-normal">· optional</span></label><input id="businessPhone" name="businessPhone" bind:value={businessPhone} class="input min-h-11 !rounded-lg" placeholder="+255 712 345 678" /></div>
					<div class="sm:col-span-2"><label class="label" for="websiteUrl">Website <span class="font-normal text-slate-400">(optional)</span></label><input id="websiteUrl" name="websiteUrl" type="url" bind:value={websiteUrl} onblur={normalizeWebsite} class="input min-h-11 !rounded-lg" placeholder="https://yourbusiness.com" /></div>
				</div>

				{#if needsSystemSource}
					<div class="mt-8 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
						<h3 class="text-sm font-semibold text-slate-800">{sourceQuestion}</h3>
						<p class="mt-1 text-[11px] leading-4 text-slate-500">We will guide you toward integration when your existing system should remain the source of truth.</p>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							{#each systemOptions as option (option.value)}
								<label class="cursor-pointer rounded-lg border bg-white p-3 transition {systemSource === option.value ? 'border-brand-400 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-300'}"><input type="radio" name="systemSource" value={option.value} bind:group={systemSource} class="sr-only" /><span class="block text-xs font-semibold text-slate-700">{option.label}</span><span class="mt-0.5 block text-[10px] text-slate-400">{option.hint}</span></label>
							{/each}
						</div>
					</div>
				{/if}

				<div class="mt-8 flex items-center justify-between gap-3"><button type="button" class="btn-secondary min-h-11 !rounded-lg" onclick={() => go(1)}>← Back</button><button type="button" class="btn-primary min-h-11 !rounded-lg !px-6" disabled={!stepTwoReady} onclick={() => forward(3)}>Continue →</button></div>
			</section>

			<section data-step="3" class:hidden={step !== 3} aria-labelledby="plan-title">
				<div class="mb-7"><p class="text-[10px] font-bold tracking-[0.16em] text-brand-600 uppercase">Step 3 of 3</p><h2 id="plan-title" class="mt-2 text-xl font-bold tracking-tight text-slate-900">Choose how you want to start.</h2><p class="mt-1.5 text-xs leading-5 text-slate-500">Plans remain authoritative. Your workspace choices only simplify the experience.</p></div>

				{#if data.plans.length}
					<div class="grid gap-3 md:grid-cols-3">
						{#each data.plans as plan (plan.id)}
							<label class="relative cursor-pointer rounded-xl border p-4 transition {selectedPlan === plan.id ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-300' : 'border-slate-200 hover:border-slate-300'}">
								<input type="radio" name="planId" value={plan.id} bind:group={selectedPlan} class="sr-only" />
								<div class="flex items-start justify-between gap-2"><span class="text-sm font-semibold text-slate-800">{plan.name}</span>{#if plan.code === recommendedPlanCode}<span class="rounded-full bg-brand-500 px-2 py-0.5 text-[9px] font-bold text-white">Recommended</span>{/if}</div>
								<p class="mt-2 text-xl font-bold tracking-tight text-slate-900">{money(plan.priceMonthly, plan.currency)}{#if plan.priceMonthly > 0}<span class="text-[10px] font-normal text-slate-400"> / month</span>{/if}</p>
								<ul class="mt-4 space-y-1.5">{#each plan.highlights as highlight (highlight)}<li class="flex gap-1.5 text-[10px] leading-4 text-slate-500"><span class="text-success">✓</span>{highlight}</li>{/each}</ul>
							</label>
						{/each}
					</div>
				{/if}

				<div class="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
					<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Your starting workspace</p>
					<div class="mt-3 grid gap-3 text-xs sm:grid-cols-3"><div><span class="block text-slate-400">Main use</span><span class="mt-0.5 block font-semibold text-slate-700">{selectedGoal?.label}</span></div><div><span class="block text-slate-400">Business</span><span class="mt-0.5 block font-semibold text-slate-700">Tour &amp; travel operator</span></div><div><span class="block text-slate-400">Existing system</span><span class="mt-0.5 block font-semibold text-slate-700">{selectedSource?.label ?? 'Not specified'}</span></div></div>
				</div>

				{#if data.trialDays > 0}<p class="mt-5 text-center text-[11px] font-medium text-success">{data.trialDays}-day free trial · No card required · Upgrade when Connect becomes part of your operation</p>{/if}
				<div class="mt-7 flex items-center justify-between gap-3"><button type="button" class="btn-secondary min-h-11 !rounded-lg" onclick={() => go(2)}>← Back</button><button type="submit" class="btn-primary min-h-11 !rounded-lg !px-6" disabled={submitting || (data.plans.length > 0 && !selectedPlan)}>{submitting ? 'Creating your workspace…' : 'Create my workspace'}</button></div>
			</section>
		</div>
	</form>

	{#snippet footer()}
		Signed in as {data.fullName || 'you'} · <a href="/logout" class="font-medium text-brand-600 hover:underline">Sign out</a>
	{/snippet}
</AuthShell>
