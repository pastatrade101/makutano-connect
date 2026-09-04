<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	let { data, form } = $props();

	/** Each brand image, with the shape it actually becomes. */
	const BRAND_SLOTS = [
		{
			slot: 'logo',
			label: 'Logo',
			ratio: 'square',
			hint: 'Square works best. Shown beside your name on the marketplace, and on your quotes and emails.'
		},
		{
			slot: 'cover',
			label: 'Banner',
			ratio: 'wide  3:1',
			hint: 'A wide photo across the top of your storefront. Around 1600 x 500 keeps it sharp.'
		}
	] as const;

	// Which slot has a file chosen. The upload button stays disabled until there is
	// something to upload, so the commonest mistake — pressing Upload having picked
	// nothing, and getting a validation error back — cannot happen.
	let busy = $state<string | null>(null);

	const publicUrl = $derived(`https://journeys.makutano.co.tz/operators/${data.profile.slug}`);
	// Seeded once, then owned by the operator while they type — untrack makes
	// that a stated intent rather than an accidental snapshot.
	let slug = $state(untrack(() => data.profile.slug));
</script>

<svelte:head><title>Business profile · {data.business.name}</title></svelte:head>

<FormToast {form} successTitle="Profile updated" />

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Business profile</h1>
		<p class="text-xs text-slate-400">Anything you skipped when you signed up lives here.</p>
	</div>

	<!-- The two halves are separated visually because the difference is real: one
	     is how we reach you, the other is what a traveller reads. -->
	<section class="rounded-panel border border-slate-200 bg-white p-5">
		<h2 class="text-sm font-semibold text-slate-900">Business details</h2>
		<p class="mt-1 text-xs text-slate-400">How Makutano reaches you. Never shown on the marketplace.</p>

		<form method="POST" action="?/saveBusiness" use:enhance class="mt-4 grid gap-4 sm:grid-cols-2">
			<div>
				<label class="label" for="industry">Industry</label>
				<input id="industry" name="industry" class="input" value={data.business.industry ?? 'TRAVEL_TOURISM'} />
			</div>
			<div>
				<label class="label" for="country">Country</label>
				<select id="country" name="country" class="input" value={data.business.country ?? 'TZ'}>
					{#each data.countries as c (c.code)}<option value={c.code}>{c.name}</option>{/each}
				</select>
			</div>
			<div>
				<label class="label" for="businessPhone">Business phone</label>
				<input id="businessPhone" name="businessPhone" class="input" value={data.business.businessPhone ?? ''} placeholder="+255 712 345 678" />
			</div>
			<div>
				<label class="label" for="bizWebsite">Website</label>
				<input id="bizWebsite" name="websiteUrl" class="input" value={data.business.websiteUrl ?? ''} placeholder="https://example.com" />
			</div>
			{#if data.canWrite}
				<div class="sm:col-span-2"><button class="btn-primary" type="submit">Save business details</button></div>
			{/if}
		</form>
	</section>

	<section class="rounded-panel border border-slate-200 bg-white p-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">Public operator profile</h2>
				<p class="mt-1 text-xs text-slate-400">What travellers see on the marketplace.</p>
			</div>
			{#if data.profile.isVerified}
				<span class="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Verified operator</span>
			{/if}
		</div>

		<p class="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
			Your public page: <a href={publicUrl} target="_blank" rel="noopener" class="font-medium text-brand-600 underline">{publicUrl}</a>
		</p>

		<form method="POST" action="?/saveProfile" use:enhance class="mt-4 grid gap-4 sm:grid-cols-2">
			<div>
				<label class="label" for="displayName">Name travellers see</label>
				<input id="displayName" name="displayName" class="input" value={data.profile.displayName} required />
			</div>
			<div>
				<label class="label" for="slug">Public address</label>
				<input id="slug" name="slug" class="input" bind:value={slug} />
				<p class="mt-1 text-[11px] text-slate-400">/operators/{slug}</p>
			</div>

			<div class="sm:col-span-2">
				<label class="label" for="about">About</label>
				<textarea id="about" name="about" rows="4" class="input" placeholder="Who you are, how long you have been running trips, what you are known for.">{data.profile.about ?? ''}</textarea>
			</div>

			<div>
				<label class="label" for="location">Based in</label>
				<input id="location" name="location" class="input" value={data.profile.location ?? ''} placeholder="Arusha, Tanzania" />
			</div>
			<div>
				<label class="label" for="yearsInBusiness">Years operating</label>
				<input id="yearsInBusiness" name="yearsInBusiness" type="number" min="0" max="200" class="input" value={data.profile.yearsInBusiness ?? ''} />
			</div>

			<div>
				<label class="label" for="specialties">Specialties</label>
				<input id="specialties" name="specialties" class="input" value={data.profile.specialties.join(', ')} placeholder="Migration safaris, Photographic" />
				<p class="mt-1 text-[11px] text-slate-400">Comma separated.</p>
			</div>
			<div>
				<label class="label" for="languages">Languages</label>
				<input id="languages" name="languages" class="input" value={data.profile.languages.join(', ')} placeholder="English, Swahili" />
			</div>

			<div class="sm:col-span-2 mt-1 border-t border-slate-100 pt-4">
				<h3 class="text-xs font-semibold text-slate-700">Public contact</h3>
				<!-- Said plainly, because publishing a personal mobile should be a
				     decision rather than an accident. -->
				<!-- Both sides of the trade-off. The privacy cost was already stated; the
				     cost of leaving it blank was not, and that is the one that loses work. -->
				<p class="mt-1 text-[11px] leading-5 text-slate-400">
					Shown on your public page, so these will be crawled and scraped. Leave any of them blank to show nothing —
					but a traveller reading a quotation you sent replies through these, so with none of them set they have no
					way to accept it or ask for a change.
				</p>
			</div>
			<div>
				<label class="label" for="publicEmail">Public email</label>
				<input id="publicEmail" name="publicEmail" type="email" class="input" value={data.profile.publicEmail ?? ''} />
			</div>
			<div>
				<label class="label" for="publicPhone">Public phone</label>
				<input id="publicPhone" name="publicPhone" class="input" value={data.profile.publicPhone ?? ''} />
			</div>
			<div class="sm:col-span-2">
				<label class="label" for="pubWebsite">Public website</label>
				<input id="pubWebsite" name="websiteUrl" class="input" value={data.profile.websiteUrl ?? ''} placeholder="https://example.com" />
			</div>

			<div class="sm:col-span-2 mt-1 border-t border-slate-100 pt-4">
				<h3 class="text-xs font-semibold text-slate-700">Search listing</h3>
				<p class="mt-1 text-[11px] text-slate-400">How your page appears in search results. Optional.</p>
			</div>
			<div>
				<label class="label" for="seoTitle">Title</label>
				<input id="seoTitle" name="seoTitle" class="input" value={data.profile.seoTitle ?? ''} />
			</div>
			<div>
				<label class="label" for="seoDescription">Description</label>
				<input id="seoDescription" name="seoDescription" class="input" value={data.profile.seoDescription ?? ''} />
			</div>

			{#if data.canWrite}
				<div class="sm:col-span-2"><button class="btn-primary" type="submit">Save public profile</button></div>
			{/if}
		</form>

		<div class="mt-6 border-t border-slate-100 pt-5">
			<h3 class="text-sm font-semibold text-slate-800">Brand images</h3>
			<p class="mt-0.5 text-xs text-slate-500">
				This is the only place your logo is set. It appears on your marketplace storefront and on
				every quote and email you send.
			</p>

			{#if !data.mediaEnabled}
				<p class="mt-3 rounded-panel border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-slate-700">
					Image upload is not configured on this deployment yet.
				</p>
			{:else}
				<!-- Logo and banner are not the same control.
				     One is a small square that sits beside your name; the other is a wide
				     header behind it. Rendering both as identical grey boxes — which is what
				     this did — tells an operator nothing about what shape of picture to bring,
				     so each preview is now the shape and size of the thing it becomes. -->
				<div class="mt-4 space-y-4">
					{#each BRAND_SLOTS as item (item.slot)}
						{@const current = item.slot === 'logo' ? data.profile.logo : data.profile.cover}
						<div class="rounded-panel border border-slate-200 p-3 sm:flex sm:items-start sm:gap-4">
							<div class="{item.slot === 'logo' ? 'size-20' : 'h-20 w-full sm:w-60'} shrink-0 overflow-hidden rounded-panel border border-slate-200 bg-slate-50">
								{#if current}
									<img src={current.url} alt={current.altText ?? item.label} class="size-full {item.slot === 'logo' ? 'object-contain p-1.5' : 'object-cover'}" />
								{:else}
									<span class="flex size-full items-center justify-center text-center text-[11px] leading-tight text-slate-400">{item.ratio}</span>
								{/if}
							</div>

							<div class="mt-3 min-w-0 flex-1 sm:mt-0">
								<p class="text-sm font-medium text-slate-800">{item.label}</p>
								<p class="mt-0.5 text-xs text-slate-500">{item.hint}</p>

								{#if data.canWrite}
									<form
										method="POST"
										action="?/uploadImage"
										enctype="multipart/form-data"
										use:enhance={() => async ({ update }) => { busy = null; await update(); }}
										class="mt-3 flex flex-wrap items-center gap-2"
									>
										<input type="hidden" name="slot" value={item.slot} />
										<!-- The file input is styled through ::file-selector-button (see app.css)
										     rather than hidden behind a fake button: a real input keeps the
										     keyboard and screen-reader behaviour the browser already gives us. -->
										<input
											type="file"
											name="file"
											accept="image/jpeg,image/png,image/webp,image/avif"
											required
											aria-label="{current ? 'Replace' : 'Upload'} {item.label.toLowerCase()}"
											class="file-input min-w-0 flex-1"
											onchange={(e) => (busy = e.currentTarget.files?.length ? item.slot : null)}
										/>
										<button class="btn-secondary !py-1.5 text-xs" type="submit" disabled={busy !== item.slot}>
											{current ? 'Replace' : 'Upload'}
										</button>
									</form>
									{#if current}
										<form method="POST" action="?/removeImage" use:enhance class="mt-2">
											<input type="hidden" name="slot" value={item.slot} />
											<button class="text-xs font-medium text-slate-500 hover:text-danger hover:underline" type="submit">
												Remove {item.label.toLowerCase()}
											</button>
										</form>
									{/if}
								{:else if !current}
									<p class="mt-3 text-xs text-slate-400">Nothing uploaded yet.</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<p class="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-500">
			Verification is a check the Makutano team performs, so it is not editable here — a badge an
			operator could grant themselves would mean nothing to a traveller deciding who to trust.
		</p>
	</section>
</div>
