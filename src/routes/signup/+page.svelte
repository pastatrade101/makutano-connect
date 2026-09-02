<script lang="ts">
	/**
	 * Signup, step one of three: the account and nothing else.
	 *
	 * Laid out as a split screen with the form on the LEFT, matching /login. The
	 * two pages are the only thing a signed-out visitor sees, and a person
	 * toggling between "create an account" and "sign in" should not watch the
	 * form jump across the screen.
	 */
	import { enhance } from '$lib/forms';
	import BrandLockup from '$lib/components/BrandLockup.svelte';
	import SignupShowcase from '$lib/components/SignupShowcase.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let password = $state('');
	let confirm = $state('');

	/** The three steps, so the bar and the label cannot disagree. */
	const STEPS = ['Account', 'Business', 'Connect'];
	const STEP = 1;

	// Mirrors the server's rule set — the server is still the one that decides.
	const strength = $derived.by(() => {
		if (!password) return { label: '', width: 0, tone: '' };
		let score = 0;
		if (password.length >= 10) score++;
		if (password.length >= 16) score++;
		if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
		if (/[0-9]/.test(password)) score++;
		if (/[^A-Za-z0-9]/.test(password)) score++;
		if (password.length < 10) return { label: 'Too short', width: 20, tone: 'bg-danger' };
		if (score <= 2) return { label: 'Weak', width: 40, tone: 'bg-danger' };
		if (score === 3) return { label: 'Fair', width: 65, tone: 'bg-warning' };
		if (score === 4) return { label: 'Good', width: 85, tone: 'bg-info' };
		return { label: 'Strong', width: 100, tone: 'bg-success' };
	});

	const mismatch = $derived(confirm.length > 0 && confirm !== password);
</script>

<svelte:head>
	<title>Create your account · Makutano Connect</title>
	<meta
		name="description"
		content="Create a Makutano Connect workspace: list your tours on Makutano Journeys and run enquiries, quotations and bookings in one place."
	/>
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<!--
	The split waits for lg.

	At md it gave the form 0.86fr against the panel's 1.14fr, and a 768px tablet
	got a 266px form card — narrower than the 343px the same form gets on a 375px
	phone, with 208px inputs. The panel is decoration; the form is the page. It
	does not get to take half the screen until there is a screen to halve.
-->
<div class="min-h-screen bg-[#f7f5f1] lg:grid lg:grid-cols-[minmax(430px,1fr)_minmax(420px,1fr)]">
	<main class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-8 md:py-12">
		<div
			class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_5%,rgba(180,83,42,0.07),transparent_25rem)]"
			aria-hidden="true"
		></div>

		<div class="relative w-full max-w-md">
			<BrandLockup size="md" />

			<div class="mt-9 sm:mt-12">
				<p class="text-[10px] font-bold tracking-[0.18em] text-brand-600 uppercase">
					Create your workspace
				</p>
				<h1 class="mt-2 text-[32px] font-bold tracking-[-0.035em] text-slate-900 sm:text-[38px]">
					Start here.
				</h1>
				<p class="mt-2 max-w-sm text-sm leading-6 text-slate-500">
					Your account first. Business details and your WhatsApp number come after — this step is
					four fields.
				</p>
			</div>

			<!--
				Step indicator.

				A filled bar means FINISHED, and on this page nothing is finished yet —
				an earlier version filled the first bar solid while the form below it was
				still empty, which read as "Account: done" to somebody who had typed
				nothing. So the current step is tinted, not filled: you are here, and the
				bar completes when the step does.
			-->
			<div class="mt-8">
				<div class="flex items-baseline justify-between">
					<span class="text-[11px] font-semibold text-slate-600">
						Step {STEP} of {STEPS.length} · {STEPS[STEP - 1]}
					</span>
					<span class="text-[11px] text-slate-400">About a minute</span>
				</div>
				<div class="mt-2 flex gap-1.5">
					{#each STEPS as name, i (name)}
						<div
							class="h-1.5 flex-1 rounded-full {i < STEP - 1
								? 'bg-brand-500'
								: i === STEP - 1
									? 'bg-brand-200'
									: 'bg-slate-200'}"
						></div>
					{/each}
				</div>
				<div class="mt-1.5 flex justify-between text-[10.5px] text-slate-400">
					{#each STEPS as name, i (name)}
						<span class={i === STEP - 1 ? 'font-semibold text-brand-600' : ''}>{name}</span>
					{/each}
				</div>
			</div>

			<form
				method="POST"
				class="mt-7 space-y-5 rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_20px_55px_rgba(50,58,70,0.09)] sm:p-7"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				{#if form?.message}
					<p
						class="rounded-lg border border-danger/15 bg-danger/5 px-3 py-2.5 text-xs text-danger"
						role="alert"
					>
						{form.message}
					</p>
				{/if}

				<div>
					<label class="label" for="fullName">Full name</label>
					<input
						id="fullName"
						name="fullName"
						required
						autocomplete="name"
						value={form?.fullName ?? ''}
						class="input min-h-11 !rounded-lg"
						placeholder="Amina Hassan"
					/>
				</div>

				<div>
					<label class="label" for="email">Work email</label>
					<input
						id="email"
						name="email"
						type="email"
						required
						autocomplete="username"
						value={form?.email ?? ''}
						class="input min-h-11 !rounded-lg"
						placeholder="you@yourbusiness.com"
					/>
				</div>

				<div>
					<label class="label" for="password">Password</label>
					<input
						id="password"
						name="password"
						type="password"
						required
						autocomplete="new-password"
						bind:value={password}
						class="input min-h-11 !rounded-lg"
					/>
					{#if strength.label}
						<div class="mt-1.5 flex items-center gap-2">
							<div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
								<div
									class="h-full rounded-full transition-all {strength.tone}"
									style="width:{strength.width}%"
								></div>
							</div>
							<span class="text-[11px] font-medium text-slate-500">{strength.label}</span>
						</div>
					{:else}
						<p class="mt-1.5 text-[11px] text-slate-400">
							At least 10 characters, mixing letters with numbers or symbols.
						</p>
					{/if}
				</div>

				<div>
					<label class="label" for="confirmPassword">Confirm password</label>
					<input
						id="confirmPassword"
						name="confirmPassword"
						type="password"
						required
						autocomplete="new-password"
						bind:value={confirm}
						class="input min-h-11 !rounded-lg"
					/>
					{#if mismatch}<p class="mt-1 text-[11px] text-danger">Passwords do not match.</p>{/if}
				</div>

				<label class="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
					<input
						type="checkbox"
						name="terms"
						required
						class="mt-0.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
					/>
					<span>
						I agree to the <a href="/legal/terms" class="text-brand-600 hover:underline"
							>Terms of Service</a
						>
						and <a href="/legal/privacy" class="text-brand-600 hover:underline">Privacy Policy</a>.
					</span>
				</label>

				{#if data.turnstileSiteKey}
					<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey}></div>
				{/if}

				<button
					type="submit"
					class="btn-primary min-h-11 w-full !rounded-lg"
					disabled={submitting || mismatch}
				>
					{submitting ? 'Creating your account…' : 'Create account'}
				</button>

				<p class="text-center text-[11px] leading-5 text-slate-400">
					14-day free trial · No card required · Keep your existing systems
				</p>
			</form>

			<p class="mt-6 text-center text-xs text-slate-500">
				Already have an account?
				<a href="/login" class="font-semibold text-brand-600 hover:underline">Sign in</a>
			</p>

			<!-- The showcase is hidden below md, so the small screen gets the one
			     line it would otherwise lose entirely. -->
			<div class="mt-7 border-t border-slate-200 pt-5 text-center lg:hidden">
				<p class="text-xs font-medium text-slate-600">
					List your tours. Answer on your own WhatsApp. Quote, book and get paid.
				</p>
			</div>
		</div>
	</main>

	<SignupShowcase scale={data.scale} />
</div>
