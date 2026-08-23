<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	const token = $derived(page.url.searchParams.get('token') ?? '');
</script>

<svelte:head><title>Choose a new password · Makutano Connect</title></svelte:head>

<AuthShell title="Choose a new password" subtitle="You will be signed in once it is saved.">
	<div class="card p-6">
		{#if !data.hasToken}
			<p class="text-sm text-slate-600">
				This page needs the link from your reset email.
				<a href="/forgot-password" class="text-brand-600 hover:underline">Request a new one</a>.
			</p>
		{:else}
			<form
				class="space-y-4"
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<input type="hidden" name="token" value={token} />
				{#if form?.message}
					<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
				{/if}
				<div>
					<label class="label" for="password">New password</label>
					<input id="password" name="password" type="password" required autocomplete="new-password" class="input" />
					<p class="mt-1.5 text-[11px] text-slate-400">At least 10 characters, mixing letters with numbers or symbols.</p>
				</div>
				<div>
					<label class="label" for="confirmPassword">Confirm new password</label>
					<input id="confirmPassword" name="confirmPassword" type="password" required autocomplete="new-password" class="input" />
				</div>
				<button type="submit" class="btn-primary w-full" disabled={submitting}>
					{submitting ? 'Saving…' : 'Save and sign in'}
				</button>
			</form>
		{/if}
	</div>

	{#snippet footer()}
		<a href="/login" class="text-brand-600 hover:underline">Back to sign in</a>
	{/snippet}
</AuthShell>
