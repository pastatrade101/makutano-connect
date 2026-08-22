<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Sign in · Makutano Connect</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<div class="mb-6 text-center">
			<div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-brand-700 text-lg font-bold text-white">M</div>
			<h1 class="text-lg font-semibold text-slate-900">Makutano Connect</h1>
			<p class="mt-1 text-xs text-slate-500">Booking, WhatsApp and payment infrastructure</p>
		</div>

		<form
			method="POST"
			class="card space-y-3 p-5"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			{#if form?.message}
				<p class="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{form.message}</p>
			{/if}
			<div>
				<label class="label" for="email">Email</label>
				<input id="email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} class="input" />
			</div>
			<div>
				<label class="label" for="password">Password</label>
				<input id="password" name="password" type="password" autocomplete="current-password" required class="input" />
			</div>
			<button type="submit" class="btn-primary w-full" disabled={submitting}>
				{submitting ? 'Signing in…' : 'Sign in'}
			</button>
		</form>

		<p class="mt-4 text-center text-[11px] text-slate-400">
			Clients keep working inside their own CMS — this portal is optional.
		</p>
	</div>
</div>
