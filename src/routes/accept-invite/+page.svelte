<script lang="ts">
	import { enhance } from '$lib/forms';
	import { page } from '$app/state';
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
	let requesting = $state(false);
	const token = $derived(page.url.searchParams.get('token') ?? '');

	/*
	 * A dead link is its own screen, not an error inside the form.
	 *
	 * It used to render the ordinary form with a red line above it, so the only
	 * button on the page resubmitted the very token that had just been refused —
	 * forever, with no other way forward. `form.dead` covers a token that died
	 * between the page loading and the button being pressed.
	 */
	// `in` rather than `form?.dead`: only one of the action's failure shapes carries
	// the flag, so the union does not have the property on every member.
	const dead = $derived(data.state === 'dead' || (!!form && 'dead' in form && !!form.dead));
</script>

<svelte:head><title>Join the team · Makutano Connect</title></svelte:head>

{#if form?.accepted}
	<AuthShell title="You're in" subtitle="Welcome to {form.tenantName}.">
		<div class="card space-y-4 p-6 text-center">
			<p class="rounded-panel bg-success/10 px-3 py-3 text-sm text-success">
				Your account is active on <b>{form.tenantName}</b>.
			</p>
			<a href="/app" class="btn-primary w-full">Open the workspace</a>
		</div>
	</AuthShell>
{:else if data.state === 'missing' || data.state === 'unknown'}
	<AuthShell
		title="This link is not complete"
		subtitle="Invitation links only work in full, exactly as they were sent."
	>
		<div class="card space-y-4 p-6">
			<p class="text-sm leading-relaxed text-slate-600">
				Some apps shorten long links when they are forwarded. Open the original message and use the
				whole link, or ask whoever invited you to send it again.
			</p>
			<a href="/login" class="btn-secondary w-full">I already have an account</a>
		</div>
	</AuthShell>
{:else if dead}
	<AuthShell
		title="This invitation has expired"
		subtitle="Links last 7 days and can only be used once."
	>
		<div class="card space-y-4 p-6">
			{#if form?.requested}
				<p class="rounded-panel bg-success/10 px-3 py-2.5 text-xs text-success">
					If that invitation is still open, a new link is on its way to
					{data.email ?? 'the invited address'}. It replaces any earlier one.
				</p>
			{:else if form?.message}
				<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>
			{:else}
				<p class="text-sm leading-relaxed text-slate-600">
					We can send a new one to {data.email ?? 'the address this was sent to'}. Your invitation
					itself is still valid — only the link has aged out.
				</p>
			{/if}

			{#if !data.emailConfigured}
				<!-- Offering "we'll email you" on a deployment that cannot send mail is
				     exactly the claim PRODUCT.md rules out. -->
				<p class="rounded-panel bg-warning/10 px-3 py-2 text-xs text-slate-700">
					Email is not configured on this deployment, so we cannot send it to you. Ask whoever
					invited you to resend the invitation from their team settings and pass you the link
					directly.
				</p>
			{:else if !form?.requested}
				<form
					method="POST"
					action="?/requestNewLink"
					use:enhance={() => {
						requesting = true;
						return async ({ update }) => {
							await update({ reset: false });
							requesting = false;
						};
					}}
				>
					<input type="hidden" name="token" value={token} />
					<button type="submit" class="btn-primary w-full" disabled={requesting}>
						{requesting ? 'Sending…' : 'Send me a new link'}
					</button>
				</form>
			{/if}

			<p class="text-xs leading-relaxed text-slate-500">
				Already set up your account?
				<a href="/login" class="text-brand-600 hover:underline">Sign in</a> instead.
			</p>
		</div>
	</AuthShell>
{:else}
	<AuthShell title="Join the team" subtitle="You've been invited to work in Makutano Connect.">
		<div class="card p-6">
			<form
				method="POST"
				action="?/accept"
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
				<!--
					Shown from the FIRST view, not after a failure.

					These fields used to appear only once a submit had already failed,
					which guaranteed the first submit carried no password — and the server
					spent the invitation before it checked. That pairing is what made a new
					member's link die on their first click.
				-->
				{#if data.needsPassword || form?.needsPassword}
					<div>
						<label class="label" for="password">Choose a password</label>
						<input
							id="password"
							name="password"
							type="password"
							required
							autocomplete="new-password"
							class="input"
						/>
						<p class="mt-1.5 text-[11px] text-slate-400">
							At least 10 characters, mixing letters with numbers or symbols.
						</p>
					</div>
					<div>
						<label class="label" for="confirmPassword">Confirm password</label>
						<input
							id="confirmPassword"
							name="confirmPassword"
							type="password"
							required
							autocomplete="new-password"
							class="input"
						/>
					</div>
				{/if}
				<button type="submit" class="btn-primary w-full" disabled={submitting}>
					{submitting ? 'Joining…' : 'Accept invitation'}
				</button>
			</form>
		</div>
	</AuthShell>
{/if}
