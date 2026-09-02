<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	type Story = { key: 'whatsapp' | 'payments' | 'journey' | 'team'; eyebrow: string; title: string; caption: string };
	const stories: Story[] = [
		{
			key: 'whatsapp',
			eyebrow: 'Shared WhatsApp workspace',
			title: 'One number.\nYour whole team.',
			caption: 'Share your business WhatsApp without sharing access to everything.'
		},
		{
			key: 'payments',
			eyebrow: 'Payment operations',
			title: 'Know what happens after\n“Please pay.”',
			caption: 'Request, track and verify payments without losing the customer journey.'
		},
		{
			key: 'journey',
			eyebrow: 'Connected customer context',
			title: 'Everything stays\nconnected.',
			caption: 'Keep conversations, transactions and payments around one customer.'
		},
		{
			key: 'team',
			eyebrow: 'Team access',
			title: 'Built for teams,\nnot shared passwords.',
			caption: 'Give every person exactly the access they need.'
		}
	];

	let slide = $state(0);
	let paused = $state(false);
	let reducedMotion = $state(false);

	onMount(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (reducedMotion = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	$effect(() => {
		if (paused || reducedMotion) return;
		// Reading `slide` on purpose: any manual navigation restarts the interval, so a
		// tap is never followed a moment later by a surprise auto-advance.
		void slide;
		const timer = setInterval(() => (slide = (slide + 1) % stories.length), 6500);
		return () => clearInterval(timer);
	});

	function move(direction: number) {
		slide = (slide + direction + stories.length) % stories.length;
	}
</script>

<section
	class="showcase relative hidden min-h-screen overflow-hidden bg-[#241d16] md:flex md:items-center md:justify-center"
	aria-label="Makutano Connect product stories"
	onmouseenter={() => (paused = true)}
	onmouseleave={() => (paused = false)}
	onfocusin={() => (paused = true)}
	onfocusout={() => (paused = false)}
>
	<div class="pointer-events-none absolute inset-0" aria-hidden="true"></div>
	<div class="relative z-10 w-full max-w-2xl px-8 py-10 lg:px-12 xl:px-16">
		<div class="grid">
		{#key slide}
			<div
				class="col-start-1 row-start-1 min-w-0"
				in:fly={{ y: reducedMotion ? 0 : 10, duration: reducedMotion ? 0 : 280 }}
				out:fade={{ duration: reducedMotion ? 0 : 160 }}
			>
				<div class="mb-7">
					<div class="flex items-center gap-2 text-[11.5px] font-bold tracking-[0.18em] text-brand-200 uppercase">
						<span class="size-1.5 rounded-full bg-[#7fc79f] shadow-[0_0_0_5px_rgba(127,199,159,0.12)]"></span>
						{stories[slide].eyebrow}
					</div>
					<h2 class="mt-3 whitespace-pre-line text-[30px] leading-[1.12] font-bold tracking-[-0.035em] text-white lg:text-[38px]">
						{stories[slide].title}
					</h2>
				</div>

				<div class="overflow-hidden rounded-2xl border border-white/15 bg-white shadow-[0_30px_80px_rgba(2,12,27,0.42)]">
					<div class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
						<div class="flex items-center gap-2.5">
							<span class="flex size-7 items-center justify-center rounded-lg bg-brand-500 text-[12.5px] font-bold text-white">M</span>
							<div>
								<div class="text-[13.5px] font-semibold text-slate-800">Makutano Connect</div>
								<div class="text-[10px] tracking-wide text-slate-400 uppercase">Live workspace</div>
							</div>
						</div>
						<div class="flex gap-1"><span class="size-2 rounded-full bg-slate-200"></span><span class="size-2 rounded-full bg-slate-200"></span><span class="size-2 rounded-full bg-slate-200"></span></div>
					</div>

					{#if stories[slide].key === 'whatsapp'}
						<div class="grid min-h-[300px] grid-cols-[112px_1fr] bg-slate-50 lg:grid-cols-[145px_1fr]">
							<div class="border-r border-slate-200 bg-white p-2.5">
								<p class="mb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">Inbox</p>
								<div class="rounded-lg bg-brand-50 p-2">
									<div class="text-[11.5px] font-semibold text-slate-800">Asha M.</div>
									<div class="mt-0.5 truncate text-[10px] text-slate-500">Do you still have…</div>
								</div>
								<div class="mt-2 rounded-lg p-2 text-[10px] text-slate-400">Daniel K.</div>
							</div>
							<div class="min-w-0 p-4">
								<div class="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
									<div><div class="text-[13.5px] font-semibold text-slate-800">Asha M.</div><div class="text-[10px] text-slate-400">WhatsApp · +255 7•• ••• •28</div></div>
									<span class="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-600">Assigned to Robert</span>
								</div>
								<div class="mt-4 max-w-[86%] rounded-xl rounded-tl-sm bg-white px-3 py-2.5 text-[12.5px] leading-5 text-slate-700 shadow-sm">Hello, do you still have availability for Saturday?</div>
								<div class="mt-4 flex flex-wrap gap-2 text-[10px]">
									<span class="rounded-full bg-success/10 px-2 py-1 font-medium text-success">● Robert is typing…</span>
									<span class="rounded-full bg-purple/10 px-2 py-1 font-medium text-purple">Neema is viewing</span>
								</div>
								<button class="mt-5 rounded-lg border border-brand-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-brand-600">Take conversation</button>
							</div>
						</div>
					{:else if stories[slide].key === 'payments'}
						<div class="min-h-[300px] bg-slate-50 p-5">
							<div class="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
								<div class="flex items-start justify-between gap-3"><div><div class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Payment request</div><div class="mt-1 text-xl font-bold text-slate-900">TZS 850,000</div></div><span class="rounded-full bg-warning/10 px-2 py-1 text-[10px] font-semibold text-[#a9780c]">Verification needed</span></div>
								<div class="mt-4 grid grid-cols-2 gap-2 text-[11.5px]"><div class="rounded-lg bg-slate-50 p-2.5"><span class="text-slate-400">Customer</span><div class="font-semibold text-slate-700">Asha M.</div></div><div class="rounded-lg bg-slate-50 p-2.5"><span class="text-slate-400">Method</span><div class="font-semibold text-slate-700">M-Pesa</div></div></div>
								<div class="mt-4 space-y-2">
									{#each [{ label: 'Payment requested', tone: 'done' }, { label: 'Customer: “I have paid”', tone: 'done' }, { label: 'Awaiting verification', tone: 'active' }, { label: 'Booking updated', tone: 'later' }] as item (item.label)}
										<div class="flex items-center gap-2 text-[11.5px]"><span class="flex size-5 items-center justify-center rounded-full {item.tone === 'done' ? 'bg-success/10 text-success' : item.tone === 'active' ? 'bg-warning/15 text-[#a9780c]' : 'bg-slate-100 text-slate-300'}">{item.tone === 'done' ? '✓' : item.tone === 'active' ? '•' : ''}</span><span class={item.tone === 'later' ? 'text-slate-400' : 'font-medium text-slate-700'}>{item.label}</span></div>
									{/each}
								</div>
							</div>
						</div>
					{:else if stories[slide].key === 'journey'}
						<div class="min-h-[300px] bg-slate-50 p-5">
							<div class="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span class="flex size-9 items-center justify-center rounded-full bg-brand-50 text-[12.5px] font-bold text-brand-600">AM</span><div><div class="text-[13.5px] font-semibold text-slate-800">Asha M.</div><div class="text-[10px] text-slate-400">One customer · complete context</div></div><span class="ml-auto rounded-full bg-success/10 px-2 py-1 text-[10px] font-medium text-success">Active</span></div>
							<div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
								{#each [{ n: '01', t: 'Conversation', d: 'WhatsApp' }, { n: '02', t: 'Quotation', d: 'QT-2041' }, { n: '03', t: 'Payment', d: 'Verified' }, { n: '04', t: 'Booking', d: 'Confirmed' }] as item (item.n)}
									<div class="relative rounded-xl border border-slate-200 bg-white p-3"><div class="text-[10px] font-bold text-brand-500">{item.n}</div><div class="mt-5 text-[12.5px] font-semibold text-slate-800">{item.t}</div><div class="text-[10px] text-slate-400">{item.d}</div></div>
								{/each}
							</div>
							<p class="mt-4 text-center text-[11.5px] text-slate-500">Context follows the customer — not a disconnected spreadsheet.</p>
						</div>
					{:else}
						<div class="min-h-[300px] bg-slate-50 p-5">
							<div class="grid gap-2">
								{#each [{ initials: 'RJ', name: 'Robert', role: 'Manager', detail: '4 open conversations', access: 'Team + payments', online: true }, { initials: 'NM', name: 'Neema', role: 'Agent', detail: '2 open conversations', access: 'Assigned conversations', online: true }, { initials: 'FI', name: 'Finance', role: 'Custom role', detail: '3 payments to verify', access: 'Payment verification', online: false }] as member (member.name)}
									<div class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><span class="relative flex size-9 items-center justify-center rounded-full bg-brand-50 text-[11.5px] font-bold text-brand-600">{member.initials}{#if member.online}<span class="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-white bg-success"></span>{/if}</span><div><div class="text-[12.5px] font-semibold text-slate-800">{member.name} <span class="font-normal text-slate-400">· {member.role}</span></div><div class="text-[10px] text-slate-500">{member.detail}</div></div><span class="ml-auto hidden rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500 lg:inline">{member.access}</span></div>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<p class="mt-5 max-w-xl text-[14.5px] leading-6 text-white/75">{stories[slide].caption}</p>
			</div>
		{/key}
		</div>

		<div class="mt-7 flex items-center justify-between">
			<div class="flex items-center gap-2" role="tablist" aria-label="Product stories">
				{#each stories as story, index (story.key)}
					<button
						role="tab"
						aria-selected={slide === index}
						aria-label="Show {story.title.replace('\n', ' ')}"
						class="h-1.5 rounded-full transition-all {slide === index ? 'w-8 bg-white' : 'w-2 bg-white/30 hover:bg-white/60'}"
						onclick={() => (slide = index)}
					></button>
				{/each}
			</div>
			<div class="flex gap-2">
				<button class="flex size-9 items-center justify-center rounded-full border border-white/20 text-white/70 transition hover:border-white/40 hover:text-white" onclick={() => move(-1)} aria-label="Previous story">←</button>
				<button class="flex size-9 items-center justify-center rounded-full border border-white/20 text-white/70 transition hover:border-white/40 hover:text-white" onclick={() => move(1)} aria-label="Next story">→</button>
			</div>
		</div>
	</div>
</section>

<style>
	.showcase > :global(div:first-child) {
		background-image:
			radial-gradient(circle at 15% 15%, rgb(224 138 95 / 0.34), transparent 28rem),
			radial-gradient(circle at 88% 80%, rgb(78 202 194 / 0.16), transparent 24rem),
			linear-gradient(rgb(255 255 255 / 0.045) 1px, transparent 1px),
			linear-gradient(90deg, rgb(255 255 255 / 0.045) 1px, transparent 1px);
		background-size: auto, auto, 34px 34px, 34px 34px;
		mask-image: linear-gradient(to bottom right, black, rgb(0 0 0 / 0.55));
	}
</style>
