<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Confirm your email · Makutano Connect</title></svelte:head>

{#if data.state === 'invalid'}
	<AuthShell title="This link has expired" subtitle="Verification links can only be used once.">
		<div class="card space-y-4 p-6 text-center">
			<p class="text-sm text-slate-600">
				Sign in and we will send you a fresh one — it takes a second.
			</p>
			<a href="/login" class="btn-primary w-full">Go to sign in</a>
		</div>
	</AuthShell>
{:else}
	<AuthShell title="Confirm your email" subtitle="We sent a link to {data.email}">
		<div class="card space-y-4 p-6">
			{#if form?.message}
				<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
			{:else if form?.resent}
				<p class="rounded-panel bg-success/10 px-3 py-2 text-xs text-success">Sent — check your inbox again.</p>
			{:else if data.sent}
				<p class="rounded-panel bg-brand-50 px-3 py-2 text-xs text-brand-700">
					Click the link in that email to continue. It expires in {data.ttlHours} hours.
				</p>
			{/if}

			{#if !data.emailConfigured}
				<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-slate-700">
					Email delivery is not configured on this deployment, so the message could not be sent.
					Ask your Makutano administrator to verify your account manually.
				</p>
			{/if}

			<p class="text-xs leading-relaxed text-slate-500">
				Nothing arrived? Check your spam folder, then request another link.
			</p>

			<form
				method="POST"
				action="?/resend"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<button type="submit" class="btn-secondary w-full" disabled={submitting}>
					{submitting ? 'Sending…' : 'Resend the link'}
				</button>
			</form>
		</div>

		{#snippet footer()}
			Wrong address? <a href="/logout" class="text-brand-600 hover:underline">Sign out and start again</a>
		{/snippet}
	</AuthShell>
{/if}
