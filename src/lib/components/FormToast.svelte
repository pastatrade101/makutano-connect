<script lang="ts">
	// Bridges SvelteKit form-action results into toasts: drop into a page, pass the
	// `form` prop, and success/error feedback appears top-right Reback-style instead
	// of an inline banner.
	import { toasts } from '$lib/stores/toast.svelte';

	let { form, successTitle = 'Done' }: { form: Record<string, unknown> | null | undefined; successTitle?: string } = $props();

	let last: unknown = null;
	$effect(() => {
		if (!form || form === last) return;
		last = form;
		if (typeof form.message === 'string' && form.message) {
			// Pick a headline the operator can act on; the body is already written in
			// business language by the server's error layer.
			const m = form.message.toLowerCase();
			const title = m.includes('limit')
				? 'Plan limit reached'
				: m.includes('not included') || m.includes('not available')
					? 'Not in your plan'
					: m.includes('permission') || m.includes('access')
						? 'No access'
						: m.includes('template')
							? 'WhatsApp template issue'
							: 'Could not save';
			toasts.danger(title, form.message);
		} else if (form.success) toasts.success(successTitle);
	});
</script>
