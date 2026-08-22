<script lang="ts">
	// The browser's only job: run Meta's popup and post back the authorization code.
	// It never sees an access token, an app secret, or a tenant id.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	let { data, form } = $props();

	let sdkReady = $state(false);
	let busy = $state(false);
	let localError = $state<string | null>(null);
	let code = $state('');
	let wabaId = $state('');
	let phoneNumberId = $state('');
	let formEl: HTMLFormElement;

	const sessionToken = $derived(page.url.searchParams.get('session') ?? '');

	onMount(() => {
		if (!data.ready || !data.meta.appId) return;

		// Meta's WA_EMBEDDED_SIGNUP event carries waba_id / phone_number_id on a fresh
		// signup. The reconnect flow sends only the code — the server discovers the rest.
		const onMessage = (event: MessageEvent) => {
			if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
			try {
				const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
				if (payload?.type === 'WA_EMBEDDED_SIGNUP' && payload?.data) {
					wabaId = payload.data.waba_id ?? '';
					phoneNumberId = payload.data.phone_number_id ?? '';
				}
			} catch {
				/* not a JSON message we care about */
			}
		};
		window.addEventListener('message', onMessage);

		(window as any).fbAsyncInit = () => {
			(window as any).FB.init({ appId: data.meta.appId, autoLogAppEvents: true, xfbml: true, version: data.meta.graphVersion });
			sdkReady = true;
		};
		const script = document.createElement('script');
		script.src = 'https://connect.facebook.net/en_US/sdk.js';
		script.async = true;
		script.defer = true;
		document.head.appendChild(script);

		return () => window.removeEventListener('message', onMessage);
	});

	function launch() {
		localError = null;
		busy = true;
		(window as any).FB.login(
			(response: any) => {
				const authCode = response?.authResponse?.code;
				if (!authCode) {
					busy = false;
					localError = 'The WhatsApp connection was cancelled.';
					return;
				}
				code = authCode;
				formEl.requestSubmit();
			},
			{
				config_id: data.meta.configId,
				response_type: 'code',
				override_default_response_type: true,
				extras: { setup: {}, featureType: '', sessionInfoVersion: '3' }
			}
		);
	}
</script>

<svelte:head><title>Connect WhatsApp</title></svelte:head>

<div class="flex min-h-screen items-center justify-center px-4 py-10">
	<div class="w-full max-w-md">
		<div class="card p-6 text-center">
			<div class="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-100">
				<svg class="size-6 text-emerald-700" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.7 15L2 22l5.2-1.4A10 10 0 1 0 12 2Z" /></svg>
			</div>
			<h1 class="text-base font-semibold text-slate-900">Connect WhatsApp</h1>
			<p class="mt-1 text-xs text-slate-500">
				{data.tenantName ? `for ${data.tenantName}` : ''} — your business keeps ownership of its WhatsApp Business Account and number.
			</p>

			{#if form?.success}
				<div class="mt-5 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
					<p class="font-medium">WhatsApp connected.</p>
					<p class="mt-0.5 text-xs">
						{form.connection?.businessName ?? ''}
						{form.connection?.displayPhoneNumber ? `· ${form.connection.displayPhoneNumber}` : ''}
					</p>
				</div>
				{#if data.redirectUrl}
					<a href={data.redirectUrl} class="btn-primary mt-4 w-full">Continue</a>
				{/if}
			{:else if data.mode === 'unauthenticated'}
				<p class="mt-5 rounded-md bg-slate-50 px-3 py-3 text-xs text-slate-600">
					This connection link is invalid or has expired. Ask your provider for a new one.
				</p>
			{:else if !data.ready}
				<p class="mt-5 rounded-md bg-amber-50 px-3 py-3 text-xs text-amber-800 ring-1 ring-amber-200">
					WhatsApp onboarding is not configured on this deployment yet.
				</p>
			{:else}
				{#if form?.message || localError}
					<p class="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{form?.message ?? localError}</p>
				{/if}
				<button class="btn-primary mt-5 w-full" disabled={!sdkReady || busy} onclick={launch}>
					{busy ? 'Connecting…' : sdkReady ? 'Continue with Facebook' : 'Loading…'}
				</button>
				<p class="mt-3 text-[11px] text-slate-400">
					You will be asked to select your WhatsApp Business Account and number. We store the connection securely and never see your Facebook password.
				</p>
			{/if}

			<form method="POST" action="?/exchange" bind:this={formEl} class="hidden">
				<input type="hidden" name="code" value={code} />
				<input type="hidden" name="wabaId" value={wabaId} />
				<input type="hidden" name="phoneNumberId" value={phoneNumberId} />
				<input type="hidden" name="session" value={sessionToken} />
			</form>
		</div>
	</div>
</div>
