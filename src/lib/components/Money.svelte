<script lang="ts">
	let { amount, currency = 'USD' }: { amount: string | number | null | undefined; currency?: string } = $props();

	const formatted = $derived.by(() => {
		const n = Number(amount ?? 0);
		try {
			return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
		} catch {
			return `${currency} ${n.toFixed(2)}`;
		}
	});
</script>

<span class="tabular-nums">{formatted}</span>
