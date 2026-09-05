<script lang="ts">
	let { children } = $props();
</script>

<div class="min-h-screen bg-canvas">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
			<a href="/" class="flex items-center gap-2">
				<span class="flex size-7 items-center justify-center rounded-panel bg-brand-500 text-sm font-bold text-white">M</span>
				<span class="text-sm font-semibold text-slate-800">Makutano <span class="text-brand-500">Connect</span></span>
			</a>
			<nav class="flex gap-4 text-xs text-slate-500">
				<a href="/legal/terms" class="hover:text-brand-600">Terms</a>
				<a href="/legal/privacy" class="hover:text-brand-600">Privacy</a>
				<a href="/legal/data-deletion" class="hover:text-brand-600">Delete data</a>
				<a href="/documentation" class="hover:text-brand-600">Documentation</a>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-5 py-10">
		<article
			class="prose-sm max-w-none [&_h1]:mb-1 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-slate-800 [&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-slate-800 [&_li]:mb-1 [&_li]:text-sm [&_li]:text-slate-600 [&_p]:mb-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-600 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
		>
			{@render children()}
		</article>
		<p class="mt-10 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
			Questions about this page? Email <a href="mailto:support@makutano.co.tz" class="text-brand-600 hover:underline">support@makutano.co.tz</a>.
		</p>
	</main>
</div>
