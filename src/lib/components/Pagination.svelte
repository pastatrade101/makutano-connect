<script lang="ts">
	import { page } from '$app/state';

	let { total, pageNumber, limit }: { total: number; pageNumber: number; limit: number } = $props();

	const totalPages = $derived(Math.max(1, Math.ceil(total / limit)));
	const from = $derived(total === 0 ? 0 : (pageNumber - 1) * limit + 1);
	const to = $derived(Math.min(total, pageNumber * limit));

	function urlForPage(n: number): string {
		const url = new URL(page.url);
		url.searchParams.set('page', String(n));
		return url.pathname + url.search;
	}
</script>

<div class="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
	<span>Showing <b class="tabular-nums text-slate-700">{from}–{to}</b> of <b class="tabular-nums text-slate-700">{total}</b></span>
	<div class="flex items-center gap-1">
		<a
			href={urlForPage(Math.max(1, pageNumber - 1))}
			class="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 {pageNumber <= 1 ? 'pointer-events-none opacity-40' : ''}"
			aria-disabled={pageNumber <= 1}>Previous</a
		>
		<span class="px-2 tabular-nums">Page {pageNumber} / {totalPages}</span>
		<a
			href={urlForPage(Math.min(totalPages, pageNumber + 1))}
			class="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 {pageNumber >= totalPages ? 'pointer-events-none opacity-40' : ''}"
			aria-disabled={pageNumber >= totalPages}>Next</a
		>
	</div>
</div>
