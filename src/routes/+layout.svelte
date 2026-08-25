<script lang="ts">
	// Two pieces of feedback every page gets for free:
	//   * a progress bar while a link navigation is in flight, and
	//   * a busy state for plain (non-enhanced) forms, which otherwise look dead for
	//     the whole round trip and invite a second click.
	// Enhanced forms handle themselves through $lib/forms.
	import '../app.css';
	import { navigating } from '$app/state';
	let { children } = $props();

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
