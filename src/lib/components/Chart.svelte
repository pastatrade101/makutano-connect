<script lang="ts">
	// ApexCharts wrapper (the library Reback charts with). Client-only: the lib is
	// imported after mount so SSR never sees it; option changes update in place.
	import { onMount } from 'svelte';
	import type { ApexOptions } from 'apexcharts';

	let { options, class: cls = '' }: { options: ApexOptions; class?: string } = $props();

	let el: HTMLDivElement;
	let chart: { render: () => void; updateOptions: (o: ApexOptions) => void; destroy: () => void } | null = null;

	onMount(() => {
		let cancelled = false;
		void import('apexcharts').then(({ default: ApexCharts }) => {
			if (cancelled) return;
			chart = new ApexCharts(el, options);
			chart.render();
		});
		return () => {
			cancelled = true;
			chart?.destroy();
		};
	});

	$effect(() => {
		void options;
		chart?.updateOptions(options);
	});
</script>

<div bind:this={el} class={cls}></div>
