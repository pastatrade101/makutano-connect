<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Sign in · Makutano Connect</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<div class="mb-6 text-center">
			<div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-panel bg-brand-500 text-lg font-bold text-white shadow-panel">M</div>
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

		<p class="mt-3 text-center text-[11px] text-slate-400">
			Clients keep working inside their own CMS — this portal is optional.
			<a href="/documentation" class="text-brand-600 hover:underline">API documentation →</a>
		</p>
	</div>
</div>
