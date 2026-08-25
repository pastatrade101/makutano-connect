<script lang="ts">
	import { enhance } from '$lib/forms';
	import { page } from '$app/state';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	const token = $derived(page.url.searchParams.get('token') ?? '');
</script>

<svelte:head><title>Join the team · Makutano Connect</title></svelte:head>

<AuthShell title="Join the team" subtitle="You've been invited to work in Makutano Connect.">
	<div class="card p-6">
		{#if form?.accepted}
			<div class="space-y-4 text-center">
				<p class="rounded-panel bg-success/10 px-3 py-3 text-sm text-success">
					You're in — welcome to <b>{form.tenantName}</b>.
				</p>
				<a href="/app" class="btn-primary w-full">Open the workspace</a>
			</div>
		{:else if !data.hasToken}
			<p class="text-sm text-slate-600">This page needs the link from your invitation email.</p>
		{:else}
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
				<input type="hidden" name="token" value={token} />
				{#if form?.message}
					<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
				{/if}
				{#if form?.needsPassword}
					<div>
						<label class="label" for="password">Choose a password</label>
						<input id="password" name="password" type="password" required autocomplete="new-password" class="input" />
						<p class="mt-1.5 text-[11px] text-slate-400">At least 10 characters, mixing letters with numbers or symbols.</p>
					</div>
					<div>
						<label class="label" for="confirmPassword">Confirm password</label>
						<input id="confirmPassword" name="confirmPassword" type="password" required autocomplete="new-password" class="input" />
					</div>
				{/if}
				<button type="submit" class="btn-primary w-full" disabled={submitting}>
					{submitting ? 'Joining…' : 'Accept invitation'}
				</button>
			</form>
		{/if}
	</div>
</AuthShell>
