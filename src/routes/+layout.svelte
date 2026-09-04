<script lang="ts">
	// Two pieces of feedback every page gets for free:
	//   * a progress bar while a link navigation is in flight, and
	//   * a busy state for plain (non-enhanced) forms, which otherwise look dead for
	//     the whole round trip and invite a second click.
	// Enhanced forms handle themselves through $lib/forms.
	import '../app.css';
	import { navigating, updated } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	let { children } = $props();

	/*
	 * Surviving a deploy with the tab open.
	 *
	 * Each build renames every hashed chunk and the previous ones stop existing.
	 * A tab opened before a deploy still asks for the old names, so its next
	 * dynamic import 404s — and because use:enhance has already called
	 * preventDefault by then, the visible symptom is a button that does nothing
	 * at all. It looks like a broken form; it is a stale page.
	 *
	 * Two nets. Vite raises vite:preloadError on exactly that failed import, so
	 * reload and let the request be served by the current build. And on an
	 * ordinary navigation, if polling has already noticed a new version, leave
	 * the SPA and do a real page load. The sessionStorage guard is what stops a
	 * genuinely missing chunk turning into a reload loop.
	 */
	if (typeof window !== 'undefined') {
		window.addEventListener('vite:preloadError', () => {
			const last = Number(sessionStorage.getItem('chunk-reload') ?? 0);
			if (Date.now() - last < 10_000) return;
			sessionStorage.setItem('chunk-reload', String(Date.now()));
			location.reload();
		});
	}

	beforeNavigate((nav) => {
		if (updated.current && !nav.willUnload && nav.to?.url) {
			nav.cancel();
			location.href = nav.to.url.href;
		}
	});

	function markPlainForm(event: SubmitEvent) {
		const form = event.target as HTMLFormElement | null;
		if (!form || form.tagName !== 'FORM') return;
		// defaultPrevented means something is handling this client-side — use:enhance,
		// or a custom onsubmit. Those own their own feedback; leave them alone.
		if (event.defaultPrevented) return;

		// A second press while the first is still going: refuse it outright. This is
		// the real protection; the dimming is just how it looks.
		if (form.hasAttribute('data-busy')) {
			event.preventDefault();
			return;
		}
		form.setAttribute('data-busy', '');
		for (const el of form.querySelectorAll('button:not([type="button"]), input[type="submit"]')) {
			el.setAttribute('aria-busy', 'true');
		}
	}
</script>

<svelte:window onsubmit={markPlainForm} />

{#if navigating.to}
	<div class="mk-progress" aria-hidden="true"></div>
{/if}

{@render children()}
