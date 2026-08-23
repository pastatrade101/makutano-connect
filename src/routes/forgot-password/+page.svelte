<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Reset your password · Makutano Connect</title></svelte:head>

<AuthShell title="Reset your password" subtitle="We will email you a link to choose a new one.">
	<div class="card p-6">
		{#if form?.sent}
			<p class="rounded-panel bg-success/10 px-3 py-2 text-xs text-success">
				If that address has an account, a reset link is on its way. It expires in an hour.
			</p>
		{:else}
			<form
				class="space-y-4"
				method="POST"
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
					<input id="email" name="email" type="email" required autocomplete="username" class="input" />
				</div>
				<button type="submit" class="btn-primary w-full" disabled={submitting}>
					{submitting ? 'Sending…' : 'Send reset link'}
				</button>
			</form>
		{/if}
	</div>

	{#snippet footer()}
		<a href="/login" class="text-brand-600 hover:underline">Back to sign in</a>
	{/snippet}
</AuthShell>
