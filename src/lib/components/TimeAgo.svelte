<script lang="ts">
	// Timestamps are stored UTC and rendered in the tenant's timezone (§25).
	let { value, timezone = 'UTC' }: { value: string | Date | null | undefined; timezone?: string } = $props();

	const date = $derived(value ? new Date(value) : null);

	const relative = $derived.by(() => {
		if (!date) return '—';
		const diff = Date.now() - date.getTime();
		const minutes = Math.round(diff / 60000);
		if (Math.abs(minutes) < 1) return 'just now';
		if (Math.abs(minutes) < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		if (Math.abs(hours) < 24) return `${hours}h ago`;
		const days = Math.round(hours / 24);
		if (Math.abs(days) < 30) return `${days}d ago`;
		return date.toLocaleDateString('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' });
	});

	const absolute = $derived(date ? date.toLocaleString('en-GB', { timeZone: timezone }) : '');
</script>

<time datetime={date?.toISOString() ?? ''} title={absolute} class="whitespace-nowrap">{relative}</time>
