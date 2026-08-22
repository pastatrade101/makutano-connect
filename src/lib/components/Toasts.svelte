<script lang="ts">
	// Fixed top-right toast stack, Reback tones: white card, colored icon bubble,
	// quiet dismiss. Rendered once per shell.
	import { toasts, dismiss } from '$lib/stores/toast.svelte';

	const TONES = {
		success: 'bg-success/15 text-success',
		danger: 'bg-danger/15 text-danger',
		warning: 'bg-warning/15 text-warning',
		info: 'bg-info/15 text-info'
	} as const;

	const ICONS = {
		success: 'M4 10.5 8 14l8-8',
		danger: 'M10 6v5m0 3h.01M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
		warning: 'M10 7v4m0 3h.01M4.2 17h11.6a1.5 1.5 0 0 0 1.3-2.2L11.3 4a1.5 1.5 0 0 0-2.6 0L2.9 14.8A1.5 1.5 0 0 0 4.2 17Z',
		info: 'M10 9v5m0-8h.01M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z'
	} as const;
</script>

<div class="pointer-events-none fixed top-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
	{#each toasts.list as t (t.id)}
		<div class="pointer-events-auto flex items-start gap-3 rounded-panel border border-slate-200 bg-white p-3 shadow-md">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-panel {TONES[t.kind]}">
				<svg class="size-4.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d={ICONS[t.kind]} /></svg>
			</div>
			<div class="min-w-0 flex-1 pt-0.5">
				<p class="text-[13px] font-semibold text-slate-700">{t.title}</p>
				{#if t.detail}<p class="mt-0.5 text-xs text-slate-500">{t.detail}</p>{/if}
			</div>
			<button class="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600" onclick={() => dismiss(t.id)} aria-label="Dismiss">
				<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 5 10 10M15 5 5 15" /></svg>
			</button>
		</div>
	{/each}
</div>
