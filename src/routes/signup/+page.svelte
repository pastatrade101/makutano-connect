<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let password = $state('');
	let confirm = $state('');

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
	{#if data.turnstileSiteKey}
		<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
	{/if}
</svelte:head>

<AuthShell title="Create your account" subtitle="Start with your details — your business comes next.">
	<form
		method="POST"
		class="card space-y-4 p-6"
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

		<div>
			<label class="label" for="fullName">Full name</label>
			<input id="fullName" name="fullName" required autocomplete="name" value={form?.fullName ?? ''} class="input" placeholder="Amina Hassan" />
		</div>

		<div>
			<label class="label" for="email">Work email</label>
			<input id="email" name="email" type="email" required autocomplete="username" value={form?.email ?? ''} class="input" placeholder="you@yourbusiness.com" />
		</div>

		<div>
			<label class="label" for="password">Password</label>
			<input id="password" name="password" type="password" required autocomplete="new-password" bind:value={password} class="input" />
			{#if strength.label}
				<div class="mt-1.5 flex items-center gap-2">
					<div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
						<div class="h-full rounded-full transition-all {strength.tone}" style="width:{strength.width}%"></div>
					</div>
					<span class="text-[11px] font-medium text-slate-500">{strength.label}</span>
				</div>
			{:else}
				<p class="mt-1.5 text-[11px] text-slate-400">At least 10 characters, mixing letters with numbers or symbols.</p>
			{/if}
		</div>

		<div>
			<label class="label" for="confirmPassword">Confirm password</label>
			<input id="confirmPassword" name="confirmPassword" type="password" required autocomplete="new-password" bind:value={confirm} class="input" />
			{#if mismatch}<p class="mt-1 text-[11px] text-danger">Passwords do not match.</p>{/if}
		</div>

		<label class="flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
			<input type="checkbox" name="terms" required class="mt-0.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
			<span>
				I agree to the <a href="/legal/terms" class="text-brand-600 hover:underline">Terms of Service</a>
				and <a href="/legal/privacy" class="text-brand-600 hover:underline">Privacy Policy</a>.
			</span>
		</label>

		{#if data.turnstileSiteKey}
			<div class="cf-turnstile" data-sitekey={data.turnstileSiteKey}></div>
		{/if}

		<button type="submit" class="btn-primary w-full" disabled={submitting || mismatch}>
			{submitting ? 'Creating your account…' : 'Create account'}
		</button>
	</form>

	{#snippet footer()}
		Already have an account? <a href="/login" class="text-brand-600 hover:underline">Sign in</a>
	{/snippet}
</AuthShell>
