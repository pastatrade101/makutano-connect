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
		if (typeof form.message === 'string' && form.message) toasts.danger('Something went wrong', form.message);
		else if (form.success) toasts.success(successTitle);
	});
</script>
