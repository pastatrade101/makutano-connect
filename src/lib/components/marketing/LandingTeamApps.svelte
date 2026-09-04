<script lang="ts">
	/*
	 * Team, then the apps.
	 *
	 * The store badges render ONLY when the URLs are configured. On 4 Sep 2026 the
	 * iOS build was in TestFlight and Android had not been submitted, so a badge
	 * would have been a dead link and a false claim of availability. Setting
	 * APP_STORE_URL / PLAY_STORE_URL turns this section on with no code change.
	 */
	let {
		appStoreUrl,
		playStoreUrl,
		signupEnabled
	}: { appStoreUrl: string; playStoreUrl: string; signupEnabled: boolean } = $props();

	const hasApps = $derived(Boolean(appStoreUrl || playStoreUrl));
</script>

<section class="bg-canvas">
	<div class="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10 lg:py-24">
		<div class="grid gap-10 lg:grid-cols-2 lg:gap-16">
			<div>
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Your team</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-[34px]">
					Your business shouldn't live on one phone.
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					Invite the people who help run your tours and give each of them their own login. You choose
					what each person can see and do, and you can change it later.
				</p>
				<p class="mt-3 text-[14px] leading-7 text-slate-600">
					Sharing one account hides who did what. Separate logins mean a conversation someone else
					answered is still visible to you, and a person who leaves can be removed without changing
					everybody's password.
				</p>
				<a href="/app/crew" class="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50">
					Invite my team
				</a>
			</div>

			<div>
				<p class="text-[11.5px] font-bold tracking-[0.18em] text-brand-600 uppercase">Anywhere</p>
				<h2 class="mt-3 text-[28px] leading-tight font-bold tracking-[-0.03em] text-slate-900 text-balance sm:text-[34px]">
					Take Connect with you.
				</h2>
				<p class="mt-4 text-[15.5px] leading-7 text-slate-600">
					Tour operations don't happen only behind a desk. The same workspace opens in a browser on
					any laptop or phone, so a guide at the airstrip sees what the office sees.
				</p>

				{#if hasApps}
					<div class="mt-6 flex flex-wrap gap-3">
						{#if appStoreUrl}
							<a href={appStoreUrl} target="_blank" rel="noopener" class="inline-flex min-h-12 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800">
								Download on the App Store
							</a>
						{/if}
						{#if playStoreUrl}
							<a href={playStoreUrl} target="_blank" rel="noopener" class="inline-flex min-h-12 items-center justify-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800">
								Get it on Google Play
							</a>
						{/if}
					</div>
					<p class="mt-4 rounded-panel border border-brand-200 bg-brand-50/50 px-4 py-3 text-[13.5px] leading-6 text-slate-700">
						<strong class="font-semibold text-slate-900">Already have an account?</strong>
						Download the app and sign in with your existing Makutano Connect account.
						<strong class="font-semibold text-slate-900">Do not create another company account if your business already uses Connect.</strong>
					</p>
				{:else}
					<div class="mt-6 rounded-panel border border-slate-200 bg-white p-5">
						<p class="text-[14px] leading-7 text-slate-600">
							Connect works in the browser on a phone today. Mobile apps for iPhone and Android are
							being tested now — when they are published, this is where the download links will be.
						</p>
						<a href={signupEnabled ? '/signup' : '/login'} class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 px-4 text-[13.5px] font-semibold text-slate-700 transition hover:bg-slate-50">
							Open Connect in your browser
						</a>
					</div>
				{/if}
			</div>
		</div>
	</div>
</section>
