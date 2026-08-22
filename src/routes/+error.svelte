<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Makutano Connect</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div class="text-center">
		<p class="text-4xl font-semibold text-slate-300 tabular-nums">{page.status}</p>
		<p class="mt-2 text-sm text-slate-700">{page.error?.message ?? 'Something went wrong.'}</p>
		{#if page.error?.requestId}
			<p class="mt-1 font-mono text-[11px] text-slate-400">{page.error.requestId}</p>
		{/if}
		<a href="/app" class="btn-secondary mt-4">Back to the portal</a>
	</div>
</div>
