<script lang="ts">
	/*
	 * How to actually put the form on a website.
	 *
	 * The pipeline already worked end to end — hosted page, widget script, submit
	 * endpoint, enquiry, notification. What an operator got was a one-line snippet
	 * and no idea where to paste it, which is the difference between a feature
	 * that exists and one that gets used.
	 *
	 * Two routes, in the order most operators can actually complete them: share a
	 * link (works with no website at all), or embed (needs somewhere to paste).
	 * The preview is the real hosted page in an iframe, not a mock-up, so what you
	 * approve here is what a visitor gets.
	 */
	let {
		publicId,
		baseUrl,
		allowedOrigins = [],
		tours = []
	}: {
		publicId: string;
		baseUrl: string;
		allowedOrigins?: string[];
		tours?: { title: string; slug: string }[];
	} = $props();

	/*
	 * A link for ONE tour, with an optional offer.
	 *
	 * This is the version that suits how these operators actually sell — a
	 * WhatsApp broadcast or an Instagram story, not a website. Because the link
	 * names the tour, the enquiry arrives attached to it and the quotation prices
	 * itself; a bare form makes the operator retype the trip they already sell.
	 */
	let tourSlug = $state('');
	let offer = $state('');
	const shareUrl = $derived.by(() => {
		const params = new URLSearchParams();
		if (tourSlug) params.set('tour', tourSlug);
		if (offer.trim()) params.set('offer', offer.trim());
		const qs = params.toString();
		return qs ? `${baseUrl}/f/${publicId}?${qs}` : `${baseUrl}/f/${publicId}`;
	});

	const hostedUrl = $derived(`${baseUrl}/f/${publicId}`);
	const embedCode = $derived(`<script src="${baseUrl}/widget.js" data-widget="${publicId}"><\/script>`);

	let copied = $state<string | null>(null);
	async function copy(text: string, what: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			setTimeout(() => (copied = null), 1800);
		} catch {
			copied = null;
		}
	}

	type Platform = { id: string; label: string; steps: string[] };
	const platforms: Platform[] = [
		{
			id: 'wordpress',
			label: 'WordPress',
			steps: [
				'Open the page you want the form on and click Edit.',
				'Add a block and choose “Custom HTML”.',
				'Paste the code above into it.',
				'Update the page. The form appears where you put the block.'
			]
		},
		{
			id: 'wix',
			label: 'Wix',
			steps: [
				'Open the Wix Editor and click Add Elements, then Embed Code.',
				'Choose “Embed HTML”, then Enter Code.',
				'Paste the code above and click Apply.',
				'Drag the box to the size you want and publish.'
			]
		},
		{
			id: 'squarespace',
			label: 'Squarespace',
			steps: [
				'Edit the page and add a block where the form should go.',
				'Choose the “Code” block.',
				'Paste the code above, leaving the mode set to HTML.',
				'Save, then publish the page.'
			]
		},
		{
			id: 'html',
			label: 'Plain HTML',
			steps: [
				'Open the page file in your editor.',
				'Paste the code above where the form should appear.',
				'Upload the file to your host.'
			]
		}
	];
	let platform = $state('wordpress');
	const steps = $derived(platforms.find((p) => p.id === platform)?.steps ?? []);
</script>

<div class="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4">
	<!-- Route 1: no website needed at all. -->
	<div>
		<h3 class="text-[13px] font-semibold text-slate-800">1. Share the link</h3>
		<p class="mt-0.5 text-[12.5px] text-slate-500">
			Works with no website. Put it in your WhatsApp bio, an Instagram profile, or an email.
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<code class="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-600">{hostedUrl}</code>
			<button type="button" class="btn-secondary !py-1.5 text-xs" onclick={() => copy(hostedUrl, 'link')}>
				{copied === 'link' ? 'Copied' : 'Copy link'}
			</button>
			<a href={hostedUrl} target="_blank" rel="noopener" class="btn-secondary !py-1.5 text-xs">Open</a>
		</div>
	</div>

	<!-- Route 1b: one tour, one link — the version that needs no website. -->
	{#if tours.length}
		<div class="border-t border-slate-200 pt-4">
			<h3 class="text-[13px] font-semibold text-slate-800">Or share one tour</h3>
			<p class="mt-0.5 text-[12.5px] text-slate-500">
				Pick a tour and the enquiry arrives already attached to it, so the quotation prices itself
				instead of starting blank. Add an offer line if you are running one.
			</p>
			<div class="mt-2 grid gap-2 sm:grid-cols-2">
				<div>
					<label class="label" for="share-tour-{publicId}">Tour</label>
					<select id="share-tour-{publicId}" bind:value={tourSlug} class="input">
						<option value="">No particular tour</option>
						{#each tours as t (t.slug)}<option value={t.slug}>{t.title}</option>{/each}
					</select>
				</div>
				<div>
					<label class="label" for="share-offer-{publicId}">Offer <span class="font-normal text-slate-400">(optional)</span></label>
					<input id="share-offer-{publicId}" bind:value={offer} maxlength="120" class="input" placeholder="15% off October departures" />
				</div>
			</div>
			<div class="mt-2 flex flex-wrap items-center gap-2">
				<code class="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12.5px] text-slate-600">{shareUrl}</code>
				<button type="button" class="btn-primary !py-1.5 text-xs" onclick={() => copy(shareUrl, 'share')}>
					{copied === 'share' ? 'Copied' : 'Copy link'}
				</button>
				<a href={shareUrl} target="_blank" rel="noopener" class="btn-secondary !py-1.5 text-xs">Open</a>
			</div>
			{#if offer.trim()}
				<p class="mt-2 rounded-panel bg-white px-3 py-2 text-[12px] leading-5 text-slate-500 ring-1 ring-slate-200">
					The offer is shown to the traveller and written onto the enquiry, so you see what was
					promised before you price it. Connect does not apply the discount for you — you still set
					the quotation.
				</p>
			{/if}
		</div>
	{/if}

	<!-- Route 2: on their own site. -->
	<div class="border-t border-slate-200 pt-4">
		<h3 class="text-[13px] font-semibold text-slate-800">2. Put it on your website</h3>
		<p class="mt-0.5 text-[12.5px] text-slate-500">
			Copy this one line and paste it into your page where the form should appear.
		</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<code class="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[12px] text-slate-600">{embedCode}</code>
			<button type="button" class="btn-primary !py-1.5 text-xs" onclick={() => copy(embedCode, 'embed')}>
				{copied === 'embed' ? 'Copied' : 'Copy code'}
			</button>
		</div>

		<div class="mt-3">
			<div class="flex flex-wrap gap-1.5">
				{#each platforms as p (p.id)}
					<button
						type="button"
						onclick={() => (platform = p.id)}
						class="min-h-9 rounded-lg border px-3 text-[12.5px] font-medium transition {platform === p.id
							? 'border-brand-300 bg-brand-50 text-brand-700'
							: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
					>{p.label}</button>
				{/each}
			</div>
			<ol class="mt-3 space-y-1.5">
				{#each steps as step, i (step)}
					<li class="flex gap-2.5 text-[12.5px] leading-6 text-slate-600">
						<span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">{i + 1}</span>
						{step}
					</li>
				{/each}
			</ol>
		</div>

		<p class="mt-3 rounded-panel bg-white px-3 py-2.5 text-[12px] leading-5 text-slate-500 ring-1 ring-slate-200">
			{#if allowedOrigins.length}
				Only these sites can submit this form: <strong class="font-semibold text-slate-700">{allowedOrigins.join(', ')}</strong>.
				If you paste the code on any other domain the form will show but submissions will be refused — add the domain below first.
			{:else}
				Any website can currently embed this form. Once it is live on your own site, add that domain
				under <strong class="font-semibold text-slate-700">Allowed embed domains</strong> below so nobody else can post through it.
			{/if}
		</p>
	</div>

	<!-- The real page, not a mock-up. -->
	<div class="border-t border-slate-200 pt-4">
		<h3 class="text-[13px] font-semibold text-slate-800">What visitors will see</h3>
		<div class="mt-2 overflow-hidden rounded-panel border border-slate-200 bg-white">
			<iframe src="{hostedUrl}?embed=1" title="Form preview" class="block h-[420px] w-full border-0" loading="lazy"></iframe>
		</div>
		<p class="mt-1.5 text-[12px] text-slate-400">
			This is the live form. Anything you change above shows here after you save.
		</p>
	</div>
</div>
