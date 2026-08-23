<script lang="ts">
	import AuthShell from '$lib/components/AuthShell.svelte';

	let { data } = $props();

	const copy = {
		SUSPENDED: {
			title: 'Your account is on hold',
			body: 'Access has been paused by Makutano. Your data is safe and nothing has been deleted — we just need to sort something out with you first.'
		},
		CANCELLED: {
			title: 'This account is closed',
			body: 'The subscription has ended, so the workspace is read-only. Get in touch if you would like it reopened.'
		},
		PENDING: {
			title: 'Almost there',
			body: 'Your workspace is created and waiting on activation. We will email you the moment it is ready — usually within one business day.'
		}
	} as const;

	const message = $derived(copy[data.tenant.status as keyof typeof copy] ?? copy.SUSPENDED);
</script>

<svelte:head><title>{message.title} · Makutano Connect</title></svelte:head>

<AuthShell title={message.title} subtitle={data.tenant.name} width="md">
	<div class="card space-y-4 p-6">
		<p class="text-sm leading-relaxed text-slate-600">{message.body}</p>

		<dl class="grid gap-2 rounded-panel bg-slate-50 p-3 text-xs sm:grid-cols-2">
			<div>
				<dt class="text-slate-400">Account status</dt>
				<dd class="mt-0.5 font-semibold text-slate-700">{data.tenant.status}</dd>
			</div>
			{#if data.subscriptionStatus}
				<div>
					<dt class="text-slate-400">Subscription</dt>
					<dd class="mt-0.5 font-semibold text-slate-700">{data.subscriptionStatus}</dd>
				</div>
			{/if}
		</dl>

		<div class="flex flex-wrap gap-2">
			<a href="mailto:support@makutano.co.tz?subject=Account%20{encodeURIComponent(data.tenant.name)}" class="btn-primary">
				Contact support
			</a>
			<a href="/logout" class="btn-secondary">Sign out</a>
		</div>

		{#if !data.isOwner}
			<p class="text-[11px] text-slate-400">
				Your account owner can also resolve this — it may be quicker to ask them first.
			</p>
		{/if}
	</div>
</AuthShell>
