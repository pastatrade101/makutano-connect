<script lang="ts">
	// Reback-styled documentation shell: fixed topbar, sticky section nav, prose column.
	let { data } = $props();
</script>

<svelte:head>
	<title>Documentation · Makutano Connect</title>
	<meta name="description" content="API and portal documentation for Makutano Connect — booking, WhatsApp and payment infrastructure." />
</svelte:head>

<div class="min-h-screen">
	<header class="sticky top-0 z-20 flex h-[64px] items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
		<a href="/documentation" class="flex items-center gap-2.5">
			<div class="flex size-8 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</div>
			<div>
				<span class="text-[15px] font-bold tracking-tight text-slate-800">Makutano <span class="text-brand-500">Connect</span></span>
				<span class="ml-2 hidden rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-slate-500 uppercase sm:inline">Docs</span>
			</div>
		</a>
		<a href={data.signedIn ? '/app' : '/login'} class="btn-primary !py-1.5 text-[13px]">{data.signedIn ? 'Open portal' : 'Sign in'}</a>
	</header>

	<div class="mx-auto flex max-w-6xl gap-10 px-4 py-8 lg:px-8">
		<nav class="sticky top-[88px] hidden h-fit w-56 shrink-0 lg:block">
			<p class="pb-2 text-[10px] font-bold tracking-widest text-slate-400 uppercase">On this page</p>
			<ul class="space-y-0.5 border-l border-slate-200">
				{#each data.toc as entry (entry.id)}
					<li>
						<a
							href="#{entry.id}"
							class="-ml-px block border-l-2 border-transparent py-1 pl-3 text-[13px] text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
						>
							{entry.text}
						</a>
					</li>
				{/each}
			</ul>
		</nav>

		<article class="doc-content min-w-0 flex-1 pb-16">
			<!-- eslint-disable-next-line svelte/no-at-html-tags — our own authored markdown -->
			{@html data.html}
			<footer class="mt-12 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
				{new Date().getFullYear()} © Makutano Connect
			</footer>
		</article>
	</div>
</div>

<style>
	.doc-content :global(h2) {
		margin: 2.25rem 0 0.75rem;
		padding-top: 1rem;
		font-size: 1.35rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--color-slate-800);
		border-top: 1px solid var(--color-slate-200);
	}
	.doc-content :global(h2:first-child) {
		margin-top: 0;
		border-top: 0;
		padding-top: 0;
	}
	.doc-content :global(h3) {
		margin: 1.5rem 0 0.5rem;
		font-size: 1.02rem;
		font-weight: 700;
		color: var(--color-slate-700);
	}
	.doc-content :global(p) {
		margin: 0.65rem 0;
		font-size: 0.92rem;
		line-height: 1.7;
		color: var(--color-slate-600);
	}
	.doc-content :global(ul),
	.doc-content :global(ol) {
		margin: 0.65rem 0 0.65rem 1.25rem;
		list-style: disc;
		font-size: 0.92rem;
		line-height: 1.7;
		color: var(--color-slate-600);
	}
	.doc-content :global(li) {
		margin: 0.25rem 0;
	}
	.doc-content :global(strong) {
		color: var(--color-slate-700);
		font-weight: 600;
	}
	.doc-content :global(a) {
		color: var(--color-brand-600);
	}
	.doc-content :global(a:hover) {
		text-decoration: underline;
	}
	.doc-content :global(code) {
		background: var(--color-slate-100);
		border-radius: 4px;
		padding: 0.1rem 0.35rem;
		font-size: 0.82rem;
		color: var(--color-slate-700);
	}
	.doc-content :global(pre) {
		margin: 0.85rem 0;
		overflow-x: auto;
		border-radius: var(--radius-panel);
		background: #1f2733;
		padding: 0.9rem 1rem;
	}
	.doc-content :global(pre code) {
		background: transparent;
		padding: 0;
		font-size: 0.8rem;
		line-height: 1.65;
		color: #dbe4ee;
	}
	.doc-content :global(table) {
		width: 100%;
		margin: 0.85rem 0;
		border-collapse: collapse;
		font-size: 0.87rem;
	}
	.doc-content :global(th) {
		border-bottom: 1px solid var(--color-slate-300);
		padding: 0.5rem 0.75rem;
		text-align: left;
		font-size: 0.72rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-slate-500);
	}
	.doc-content :global(td) {
		border-bottom: 1px solid var(--color-slate-200);
		padding: 0.5rem 0.75rem;
		color: var(--color-slate-600);
	}
	.doc-content :global(h2[id]),
	.doc-content :global(h3[id]) {
		scroll-margin-top: 88px;
	}
</style>
