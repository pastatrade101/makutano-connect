// A drop-in replacement for SvelteKit's `enhance` that answers the click.
//
// Every form in Connect submits over the network. Without feedback the button looks
// dead for the half-second the round trip takes, so people press it again — and a
// second press can mean a second order, a second payment request, a second invite.
// This wrapper does two things for every form that uses it, with no per-form code:
//
//   1. marks the form busy while it is in flight, which the stylesheet turns into a
//      dimmed button with a spinner (see app.css), and
//   2. CANCELS a second submission while the first is still running — the visual cue
//      is the courtesy, this is the actual protection.
import { enhance as kitEnhance } from '$app/forms';
import type { SubmitFunction } from '@sveltejs/kit';

/** Marks the form and its submit controls, for both styling and screen readers. */
function setBusy(form: HTMLFormElement, busy: boolean): void {
	if (busy) form.setAttribute('data-busy', '');
	else form.removeAttribute('data-busy');
	for (const el of form.querySelectorAll('button:not([type="button"]), input[type="submit"]')) {
		if (busy) el.setAttribute('aria-busy', 'true');
		else el.removeAttribute('aria-busy');
	}
}

/**
 * Use exactly like `enhance` from '$app/forms' — same signature, same callbacks.
 * A submit handler may return nothing, or the usual result callback; both work.
 */
export const enhance = (form: HTMLFormElement, submit?: SubmitFunction) =>
	kitEnhance(form, (input) => {
		// Already in flight: refuse the duplicate rather than letting it through.
		if (form.hasAttribute('data-busy')) {
			input.cancel();
			return;
		}
		setBusy(form, true);

		// SvelteKit does not report cancellation back to us, so observe the caller
		// calling cancel(): a form that never submits must not sit there looking busy.
		let cancelled = false;
		const cancel = input.cancel;
		input.cancel = () => {
			cancelled = true;
			cancel();
		};

		const result = submit?.(input);
		if (cancelled) {
			setBusy(form, false);
			return result;
		}

		return async (opts) => {
			try {
				if (typeof result === 'function') await result(opts);
				else await opts.update();
			} finally {
				// Always clears, including when the action threw or redirected: a form
				// stuck in a busy state is worse than one with no state at all.
				setBusy(form, false);
			}
		};
	});
