<script lang="ts">
	import { enhance } from '$lib/forms';
	import BrandLockup from '$lib/components/BrandLockup.svelte';
	import LoginShowcase from '$lib/components/LoginShowcase.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Sign in · Makutano Connect</title>
	<meta name="description" content="Sign in to manage your Makutano Connect customer operations workspace." />
</svelte:head>

<div class="min-h-screen bg-[#f7f5f1] md:grid md:grid-cols-[minmax(330px,0.86fr)_minmax(430px,1.14fr)]">
	<main class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-8 md:py-12">
		<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_5%,rgba(180,83,42,0.07),transparent_25rem)]" aria-hidden="true"></div>
		<div class="relative w-full max-w-md">
			<BrandLockup size="md" />

			<div class="mt-10 sm:mt-14">
				<p class="text-[10px] font-bold tracking-[0.18em] text-brand-600 uppercase">Secure workspace access</p>
				<h1 class="mt-2 text-[32px] font-bold tracking-[-0.035em] text-slate-900 sm:text-[38px]">Welcome back.</h1>
				<p class="mt-2 max-w-sm text-sm leading-6 text-slate-500">Sign in to manage your conversations, customers and operations.</p>
			</div>

			<form
				method="POST"
				class="mt-8 space-y-5 rounded-xl border border-slate-200/90 bg-white p-6 shadow-[0_20px_55px_rgba(50,58,70,0.09)] sm:p-7"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				{#if form?.message}
					<p class="rounded-lg border border-danger/15 bg-danger/5 px-3 py-2.5 text-xs text-danger" role="alert">{form.message}</p>
				{/if}

				<div>
					<label class="label" for="email">Email</label>
					<input id="email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} class="input min-h-11 !rounded-lg" />
				</div>

				<div>
					<div class="mb-1.5 flex items-baseline justify-between gap-3">
						<label class="label mb-0" for="password">Password</label>
						<a href="/forgot-password" class="text-[11px] font-medium text-brand-600 hover:underline">Forgot password?</a>
					</div>
					<PasswordField id="password" label="password" autocomplete="current-password" required class="min-h-11 !rounded-lg" />
				</div>

				<button type="submit" class="btn-primary min-h-11 w-full !rounded-lg" disabled={submitting}>
					{submitting ? 'Signing in…' : 'Sign in'}
				</button>
			</form>

			{#if data.signupEnabled}
				<p class="mt-6 text-center text-xs text-slate-500">
					New to Makutano Connect?
					<a href="/signup" class="font-semibold text-brand-600 hover:underline">Create an account</a>
				</p>
			{/if}

			<div class="mt-7 border-t border-slate-200 pt-5 text-center md:hidden">
				<p class="text-xs font-medium text-slate-600">Keep your systems. Connect the missing pieces.</p>
				<a href="/" class="mt-2 inline-block text-[11px] font-semibold text-brand-600 hover:underline">Explore Makutano Connect →</a>
			</div>
		</div>
	</main>

	<LoginShowcase />
</div>
