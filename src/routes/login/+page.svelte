<script lang="ts">
	// Two-column SaaS auth: the form (untouched behavior) on the left, a quiet product
	// showcase on the right. On phones the showcase disappears — signing in is the job.
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let submitting = $state(false);

	type Slide = { key: string; title: string; description: string };
	const SLIDES: Slide[] = [
		{
			key: 'whatsapp',
			title: 'Connect WhatsApp to your business',
			description: 'Use your own WhatsApp Business number and manage customer conversations through one reliable infrastructure.'
		},
		{
			key: 'bookings',
			title: 'Bookings that work with your existing system',
			description: 'Keep managing tours, services, products and customers in your existing CMS while Makutano Connect handles booking infrastructure.'
		},
		{
			key: 'payments',
			title: 'Payments connected to the journey',
			description: 'Connect bookings, payment requests, confirmations and customer notifications without rebuilding your business software.'
		},
		{
			key: 'teams',
			title: 'Built for teams',
			description: 'Manage shared conversations with assignment, ownership, presence, customer history and team collaboration.'
		}
	];

	let slide = $state(0);
	let paused = $state(false);

	// Slow auto-rotate; pauses while the visitor is looking at or touching the panel.
	$effect(() => {
		if (paused) return;
		const timer = setInterval(() => (slide = (slide + 1) % SLIDES.length), 7000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Sign in · Makutano Connect</title></svelte:head>

<div class="min-h-screen bg-white lg:grid lg:grid-cols-2">
	<!-- ------------------------------------------------------------- Sign in -->
	<div class="flex min-h-screen items-center justify-center px-4 py-10 lg:min-h-0">
		<div class="w-full max-w-sm">
			<div class="mb-6 text-center">
				<a href="/" class="inline-block" aria-label="Makutano Connect home">
					<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-panel bg-brand-500 text-lg font-bold text-white shadow-panel">M</div>
				</a>
				<h1 class="text-xl font-bold tracking-tight text-slate-800">Makutano <span class="text-brand-500">Connect</span></h1>
				<p class="mt-1 text-xs text-slate-400">Booking, WhatsApp and payment infrastructure</p>
			</div>

			<form
				method="POST"
				class="card space-y-4 p-6"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				{#if form?.message}
					<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
				{/if}
				<div>
					<label class="label" for="email">Email</label>
					<input id="email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} class="input" />
				</div>
				<div>
					<div class="mb-1.5 flex items-baseline justify-between">
						<label class="label mb-0" for="password">Password</label>
						<a href="/forgot-password" class="text-[11px] text-brand-600 hover:underline">Forgot password?</a>
					</div>
					<input id="password" name="password" type="password" autocomplete="current-password" required class="input" />
				</div>
				<button type="submit" class="btn-primary w-full" disabled={submitting}>
					{submitting ? 'Signing in…' : 'Sign in'}
				</button>
			</form>

			{#if data.signupEnabled}
				<p class="mt-5 text-center text-xs text-slate-500">
					New to Makutano Connect?
					<a href="/signup" class="font-medium text-brand-600 hover:underline">Create an account</a>
				</p>
			{/if}

			<p class="mt-4 text-center text-[11.5px] leading-relaxed text-slate-400">
				Your business stays where it is. Makutano Connect powers the infrastructure behind it.
			</p>
			<p class="mt-1.5 text-center">
				<a href="/" class="text-[12px] font-medium text-brand-600 hover:underline">Explore the platform →</a>
			</p>
		</div>
	</div>

	<!-- ---------------------------------------------------- Product showcase -->
	<div class="hidden items-center justify-center border-l border-slate-200 bg-slate-50/70 p-10 lg:flex">
		<section
			class="w-full max-w-md"
			aria-label="Product highlights"
			onmouseenter={() => (paused = true)}
			onmouseleave={() => (paused = false)}
			onfocusin={() => (paused = true)}
			onfocusout={() => (paused = false)}
		>
			<div class="card overflow-hidden">
				<!-- Vignette: the same components the portal is made of -->
				<div class="flex h-64 items-center justify-center border-b border-slate-100 bg-slate-50/60 px-8">
					{#if SLIDES[slide].key === 'whatsapp'}
						<div class="w-full space-y-2.5" role="img" aria-label="A WhatsApp conversation in the shared inbox">
							<div class="flex items-center justify-between text-[11px] text-slate-400">
								<span class="font-semibold text-slate-600">Amina Hassan</span><span>Neema is typing…</span>
							</div>
							<div class="max-w-[85%] rounded-panel bg-white px-3 py-2 text-[12.5px] text-slate-700 shadow-panel">Habari! Do you still have space for Saturday?</div>
							<div class="ml-auto max-w-[85%] rounded-panel bg-brand-50 px-3 py-2 text-[12.5px] text-slate-700">
								Yes — two seats left. Sending the details now.
								<span class="mt-0.5 flex justify-end text-brand-500" aria-hidden="true">
									<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m2 10.5 3 3 5.5-6M9 13l1.5 1.5L16 8" /></svg>
								</span>
							</div>
							<div class="flex gap-1.5 pt-1">
								<span class="badge bg-brand-50 text-brand-600">Assigned to Neema</span>
								<span class="badge bg-success/10 text-success">Open</span>
							</div>
						</div>
					{:else if SLIDES[slide].key === 'bookings'}
						<div class="w-full" role="img" aria-label="A booking synced from an external website">
							<div class="rounded-panel border border-slate-200 bg-white p-4 shadow-panel">
								<div class="flex items-start justify-between gap-2">
									<div>
										<div class="font-mono text-[10.5px] text-slate-400">GFA-BK-2026-00214</div>
										<div class="mt-0.5 text-[13.5px] font-semibold text-slate-800">7 Day Serengeti Migration Safari</div>
										<div class="mt-0.5 text-[11.5px] text-slate-400">Synced from your website · 2 adults</div>
									</div>
									<span class="badge bg-success/10 text-success">Confirmed</span>
								</div>
								<div class="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[12px]">
									<div><span class="text-slate-400">Total</span> <span class="font-semibold text-slate-700">USD 4,900</span></div>
									<div><span class="text-slate-400">Deposit</span> <span class="font-semibold text-success">Received</span></div>
								</div>
							</div>
							<p class="mt-3 text-center text-[11px] text-slate-400">Your website stays the source of truth.</p>
						</div>
					{:else if SLIDES[slide].key === 'payments'}
						<ol class="w-full space-y-2.5" role="img" aria-label="A payment moving from request to verification">
							<li class="flex items-center justify-between rounded-panel border border-slate-200 bg-white px-3.5 py-2.5 shadow-panel">
								<span class="text-[12.5px] font-medium text-slate-700">Payment requested</span>
								<span class="badge bg-brand-50 text-brand-600">TZS 850,000</span>
							</li>
							<li class="flex items-center justify-between rounded-panel border border-slate-200 bg-white px-3.5 py-2.5 shadow-panel">
								<span class="text-[12.5px] font-medium text-slate-700">Customer: “I have paid”</span>
								<span class="badge bg-warning/10 text-warning">Awaiting check</span>
							</li>
							<li class="flex items-center justify-between rounded-panel border border-slate-200 bg-white px-3.5 py-2.5 shadow-panel">
								<span class="text-[12.5px] font-medium text-slate-700">Verified & booking updated</span>
								<span class="badge bg-success/10 text-success">Paid</span>
							</li>
						</ol>
					{:else}
						<div class="w-full space-y-2" role="img" aria-label="Team workload in the shared inbox">
							{#each [{ n: 'Neema Joseph', s: '4 open · 21 replies today', online: true }, { n: 'Robert Mushi', s: '6 open · 18 replies today', online: true }, { n: 'Grace Temba', s: '2 open · 9 replies today', online: false }] as m (m.n)}
								<div class="flex items-center gap-2.5 rounded-panel border border-slate-200 bg-white px-3 py-2 shadow-panel">
									<span class="relative flex size-7 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-600">
										{m.n.slice(0, 1)}
										{#if m.online}<span class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-white bg-success"></span>{/if}
									</span>
									<span class="text-[12.5px] font-medium text-slate-700">{m.n}</span>
									<span class="ml-auto text-[11px] text-slate-400">{m.s}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<div class="p-6">
					<h2 class="text-[15px] font-semibold text-slate-800">{SLIDES[slide].title}</h2>
					<p class="mt-1.5 min-h-[3.5rem] text-[13px] leading-relaxed text-slate-500">{SLIDES[slide].description}</p>
					<div class="mt-4 flex items-center gap-1.5" role="tablist" aria-label="Product highlight slides">
						{#each SLIDES as s, i (s.key)}
							<button
								role="tab"
								aria-selected={i === slide}
								aria-label="Slide {i + 1}: {s.title}"
								class="h-1.5 rounded-full transition-all duration-300 {i === slide ? 'w-6 bg-brand-500' : 'w-1.5 bg-slate-300 hover:bg-slate-400'}"
								onclick={() => (slide = i)}
							></button>
						{/each}
					</div>
				</div>
			</div>
		</section>
	</div>
</div>
