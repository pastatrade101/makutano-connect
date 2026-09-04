<script lang="ts">
	/*
	 * Setting up tracking, in the operator's language.
	 *
	 * Nothing here names the tracking platform, a device id, a protocol or a
	 * port — with one unavoidable exception, flagged rather than worked around:
	 * the app in both stores is called "Traccar Client", and you cannot tell
	 * somebody to install an app without naming it.
	 */
	import { enhance } from '$app/forms';
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	let { data, form } = $props();

	let profile = $state('SAFARI');
	let label = $state('');
	let showTyped = $state(false);
	let waiting = $state<string | null>(null);
	let remaining = $state('');

	// The two platform notes below are not polish. On Android 11+ background
	// location is a second prompt plus a settings trip; the app never asks about
	// battery optimisation at all; and on iOS "Allow While Using App" leaves the
	// app showing tracking ON while it silently stops the moment the phone locks.
	const ANDROID = 'Android: open Settings › Apps › Traccar Client › Battery and choose Unrestricted, or the phone stops sending after a few minutes.';
	const IPHONE = 'iPhone: open Settings › Traccar Client › Location and choose Always.';

	$effect(() => {
		if (!data.pending) return;
		const expires = new Date(data.pending.expiresAt).getTime();
		const tick = setInterval(() => {
			const left = Math.max(0, expires - Date.now());
			const m = Math.floor(left / 60000);
			const s = Math.floor((left % 60000) / 1000);
			remaining = `${m}:${String(s).padStart(2, '0')}`;
			if (left === 0) clearInterval(tick);
		}, 1000);
		return () => clearInterval(tick);
	});

	// Polling asks only whether the phone has reported. It never re-fetches the
	// code — the code was rendered once, to this operator.
	$effect(() => {
		if (!data.pending) return;
		const poll = setInterval(async () => {
			const res = await fetch(`/app/vehicles/${data.vehicle.id}/tracking/status`);
			if (!res.ok) return;
			const body = await res.json();
			waiting = body.data?.status ?? null;
			if (body.data?.status === 'ACTIVE') {
				clearInterval(poll);
				await invalidateAll();
			}
		}, 4000);
		return () => clearInterval(poll);
	});
</script>

<svelte:head><title>Set up tracking · {data.vehicle.name}</title></svelte:head>

<div class="mx-auto w-full max-w-3xl space-y-4">
	<div>
		<a href="/app/vehicles" class="text-xs text-slate-400 hover:underline">← Vehicles</a>
		<h1 class="mt-0.5 text-lg font-semibold text-slate-900">{data.vehicle.name}</h1>
		<p class="text-xs text-slate-500">{data.vehicle.registration || 'No registration recorded'}</p>
	</div>

	{#if form?.message}
		<p class="rounded-panel border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{form.message}</p>
	{/if}

	{#if data.active}
		<!-- Tracked. The reference is never shown here; the tracker is identified
		     by the name the operator gave it. -->
		<div class="card space-y-3 p-4">
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-sm font-semibold text-slate-900">Tracking is set up</p>
					<p class="mt-0.5 text-xs text-slate-500">
						{data.active.label || 'Driver’s phone'} · since {new Date(data.active.since).toLocaleDateString('en-GB')}
					</p>
				</div>
				<span class="badge bg-success/10 text-success ring-1 ring-success/20">Connected</span>
			</div>
			<div class="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
				<form method="POST" action="?/start" use:enhance>
					<input type="hidden" name="profile" value={profile} />
					<button class="btn-secondary">Replace tracking device</button>
				</form>
				<form method="POST" action="?/remove" use:enhance>
					<button class="btn-ghost text-danger">Remove tracking</button>
				</form>
			</div>
			<p class="text-[11.5px] text-slate-400">
				Replacing keeps the current device working until the new one connects — nothing goes dark.
			</p>
		</div>
	{:else if data.pending}
		<div class="card space-y-4 p-4">
			<div class="flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="text-sm font-semibold text-slate-900">Point the driver’s phone at this code</h2>
				<span class="font-mono text-xs text-slate-500">Expires in {remaining}</span>
			</div>

			<ol class="space-y-1.5 text-sm text-slate-700">
				<li>1. Install <strong>Traccar Client</strong> from the Play Store or App Store.</li>
				<li>2. Open it, tap <strong>Settings</strong>, then the scan icon at the top.</li>
				<li>3. Point it at this code.</li>
			</ol>

			<div class="flex justify-center rounded-panel bg-white p-3">
				<img src="/app/vehicles/{data.vehicle.id}/tracking/qr" alt="Setup code" width="280" height="280" />
			</div>

			<ol class="space-y-1.5 text-sm text-slate-700" start="4">
				<li>4. Turn on <strong>Continuous tracking</strong> — the app sends nothing until this is on.</li>
				<li>5. When the phone asks about location, choose <strong>Allow all the time</strong>.</li>
			</ol>
			<p class="rounded-panel bg-warning/5 px-3 py-2 text-[11.5px] text-warning">{ANDROID}<br />{IPHONE}</p>

			<div class="rounded-panel bg-slate-50 px-3 py-2.5">
				{#if waiting === 'PENDING' || waiting === null}
					<p class="text-sm text-slate-600">Waiting for the first location…</p>
					<p class="mt-1 text-[11.5px] text-slate-400">
						Nothing yet? Check continuous tracking is on, location is set to allow all the time, and the phone
						is outdoors or near a window.
					</p>
				{:else if waiting === 'EXPIRED'}
					<p class="text-sm text-slate-600">This setup code has expired.</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
				<form method="POST" action="?/start" use:enhance>
					<input type="hidden" name="profile" value={profile} />
					<button class="btn-secondary">Start again</button>
				</form>
				<form method="POST" action="?/extend" use:enhance>
					<input type="hidden" name="enrollmentId" value={data.pending.id} />
					<button class="btn-ghost text-xs">Give me {data.expiryMinutes} more minutes</button>
				</form>
				<form method="POST" action="?/cancel" use:enhance class="ml-auto">
					<input type="hidden" name="enrollmentId" value={data.pending.id} />
					<button class="btn-ghost text-xs text-slate-500">Cancel</button>
				</form>
			</div>

			<button type="button" class="text-xs text-brand-600 hover:underline" onclick={() => (showTyped = !showTyped)}>
				Can’t scan? Type it instead
			</button>
			{#if showTyped}
				<!-- The one place the reference is shown, to the one operator who
				     asked for it, on the screen that minted it. -->
				<div class="rounded-panel bg-slate-50 p-3 text-xs text-slate-600">
					<p>In the app: <strong>Settings › Device identifier</strong> — type this exactly.</p>
					<p class="my-2 select-all font-mono text-base tracking-widest text-slate-900">{data.pending.deviceRef}</p>
					<p>Letters and numbers only — no spaces or dashes.</p>
					<p class="mt-2"><strong>Server URL</strong></p>
					<p class="select-all font-mono text-slate-900">{data.pending.configurationUri.split('?')[0]}</p>
					<p class="mt-1 text-slate-400">Type nothing after /osmand.</p>
				</div>
			{/if}
		</div>
	{:else}
		<div class="card space-y-4 p-4">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">How is this vehicle tracked?</h2>
				{#if data.expiredJustNow}
					<p class="mt-1 text-xs text-slate-500">
						The last setup code expired. Codes last {data.expiryMinutes} minutes so an unused one can’t be used later.
					</p>
				{/if}
			</div>

			<form method="POST" action="?/start" use:enhance class="space-y-3">
				<div class="rounded-panel border border-brand-200 bg-brand-50/40 p-3">
					<p class="text-sm font-medium text-slate-900">Driver’s phone</p>
					<p class="mt-0.5 text-xs text-slate-500">Free. The driver installs a small app and scans a code.</p>
				</div>

				<label class="block">
					<span class="label">What should we call this tracker?</span>
					<input name="label" bind:value={label} placeholder="Juma’s phone" class="input mt-1" />
				</label>

				<div>
					<span class="label">How is it usually driven?</span>
					<div class="mt-1 flex flex-wrap gap-2">
						{#each data.profiles as p (p.key)}
							<button
								type="button"
								onclick={() => (profile = p.key)}
								class="rounded-lg border px-3 py-1.5 text-xs font-medium transition {profile === p.key
									? 'border-brand-600 bg-brand-600 text-white'
									: 'border-slate-200 text-slate-600 hover:bg-slate-50'}">{p.label}</button>
						{/each}
					</div>
					<input type="hidden" name="profile" value={profile} />
				</div>

				<button class="btn-primary" disabled={!data.trackingEnabled}>Create setup code</button>
				{#if !data.trackingEnabled}
					<p class="text-[11.5px] text-slate-400">Tracking is not switched on for this workspace yet.</p>
				{/if}
			</form>

			<p class="border-t border-slate-100 pt-3 text-[11.5px] text-slate-400">
				Fitted GPS tracker — contact support to set one up.
			</p>
		</div>
	{/if}
</div>
