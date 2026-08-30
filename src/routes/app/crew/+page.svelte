<script lang="ts">
	import { enhance } from '$lib/forms';
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	let { data, form } = $props();
	let inviting = $state<string | null>(null);
	let copied = $state(false);

	// An issued invite closes the form it came from — leaving it open reads as
	// though the invite had not been sent.
	$effect(() => {
		if (form?.invite) inviting = null;
	});

	/** wa.me wants digits only, no +, no spaces. */
	const waNumber = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '');

	const waLink = (invite: { name: string; phone?: string | null; link: string }) =>
		`https://wa.me/${waNumber(invite.phone)}?text=` +
		encodeURIComponent(
			`Hi ${invite.name}, here is your access to our trips app. Open this link to set your password:\n${invite.link}\n\nIt works once and expires in 7 days.`
		);

	async function copyLink(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}

	const TYPES = [
		{ value: 'DRIVER', label: 'Driver' },
		{ value: 'GUIDE', label: 'Guide' },
		{ value: 'SPECIALIST', label: 'Specialist' }
	];

	const groups = $derived(
		TYPES.map((t) => ({ ...t, rows: data.crew.filter((c) => c.type === t.value) })).filter((g) => g.rows.length)
	);
</script>

<svelte:head><title>Crew · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Crew" />
{:else}
<div class="mx-auto max-w-3xl space-y-4">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-lg">Crew</h1>
		<p class="mt-0.5 text-sm text-slate-500">
			The drivers, guides and specialists a trip can be assigned. They do not need a login — add an account only for
			someone who needs the app itself.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{form.error}</div>
	{/if}

	{#if form?.invite}
		{@const invite = form.invite}
		<div class="card space-y-3 border-brand-200 bg-brand-50/50 p-4">
			<div>
				<h2 class="text-sm font-semibold text-slate-900">
					{#if invite.whatsapp === 'sent'}
						Sent to {invite.name} on WhatsApp
					{:else}
						{invite.name} can sign in — send them the link
					{/if}
				</h2>
				<p class="mt-0.5 text-xs text-slate-500">
					{#if invite.whatsapp === 'sent'}
						They have the link on {invite.phone}. It sets their password, works once, and expires in 7 days.
					{:else if invite.whatsapp === 'no_phone'}
						They have no phone number on file, so WhatsApp could not be used. Add one and the next invite goes out
						automatically.
					{:else}
						WhatsApp did not send — either this workspace has no WhatsApp connected, or Meta has not approved the
						<b>crew_invite</b> template yet. Check
						<a href="/app/whatsapp/templates" class="text-brand-600 hover:underline">Message templates</a>.
					{/if}
				</p>
			</div>

			{#if invite.whatsapp !== 'sent'}
				<div class="flex flex-wrap items-center gap-2">
					<code class="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
						{invite.link}
					</code>
					<button type="button" class="btn-ghost" onclick={() => copyLink(invite.link)}>
						{copied ? 'Copied' : 'Copy'}
					</button>
					{#if waNumber(invite.phone)}
						<a class="btn-primary" href={waLink(invite)} target="_blank" rel="noreferrer noopener">
							Send on WhatsApp
						</a>
					{/if}
				</div>
			{/if}

			<p class="text-xs text-slate-400">
				{#if invite.emailed}An email also went to {invite.email}.{/if}{' '}Once they set a password they sign in at
				the same address you do — on the web or in the app — and see only the trips they are on.
			</p>
		</div>
	{/if}

	{#if data.canWrite}
		<form method="POST" action="?/create" use:enhance class="card space-y-3 p-4">
			<h2 class="card-title">Add someone</h2>
			<div class="grid gap-3 sm:grid-cols-4">
				<label class="block">
					<span class="label">Role</span>
					<select name="type" class="input w-full">
						{#each TYPES as t}<option value={t.value}>{t.label}</option>{/each}
					</select>
				</label>
				<label class="block sm:col-span-2">
					<span class="label">Name</span>
					<input name="name" required placeholder="Michael Mwakalinga" class="input w-full" />
				</label>
				<label class="block">
					<span class="label">Phone</span>
					<input name="phone" inputmode="tel" placeholder="+255…" class="input w-full" />
				</label>
			</div>
			<div class="flex items-end justify-between gap-3">
				<label class="block flex-1">
					<span class="label">Licence number <span class="text-slate-400">(optional)</span></span>
					<input name="licenceNumber" class="input w-full sm:max-w-xs" />
				</label>
				<button class="btn-primary">Add</button>
			</div>
		</form>
	{/if}

	{#if data.crew.length === 0}
		<div class="card">
			<EmptyState
				title="Nobody on the crew list yet"
				description="Add the drivers, guides and specialists you dispatch. A trip then picks from this list instead of somebody typing a name — which is how a driver nobody can reach ends up on a departure."
			/>
		</div>
	{:else}
		{#each groups as group (group.value)}
			<section class="card overflow-hidden">
				<header class="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">
					{group.label}s <span class="font-normal text-slate-400">· {group.rows.length}</span>
				</header>
				<ul class="divide-y divide-slate-100">
					{#each group.rows as person (person.id)}
						<li class="flex items-center gap-3 px-4 py-3 {person.isActive ? '' : 'bg-slate-50/60'}">
							<div class="min-w-0 flex-1">
								<div class="text-sm font-medium {person.isActive ? 'text-slate-900' : 'text-slate-400'}">
									{person.name}
									{#if !person.isActive}<span class="ml-2 text-xs font-normal">· inactive</span>{/if}
								</div>
								<div class="text-xs text-slate-500">
									{[person.phone, person.licenceNumber].filter(Boolean).join(' · ') || 'No contact details'}
								</div>
							</div>
							{#if person.userId}
								<span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
									Has the app
								</span>
							{:else if data.canWrite && data.canInvite && person.isActive}
								<button type="button" class="btn-ghost" onclick={() => (inviting = person.id)}>Give app access</button>
							{/if}
							{#if data.canWrite}
								<form method="POST" action="?/toggle" use:enhance>
									<input type="hidden" name="id" value={person.id} />
									<input type="hidden" name="isActive" value={person.isActive ? 'off' : 'on'} />
									<button class="btn-ghost">{person.isActive ? 'Deactivate' : 'Reactivate'}</button>
								</form>
							{/if}
						</li>
						{#if inviting === person.id}
							<li class="bg-brand-50/40 px-4 py-3">
								<form method="POST" action="?/invite" use:enhance class="flex flex-wrap items-end gap-2">
									<input type="hidden" name="id" value={person.id} />
									<label class="block flex-1">
										<span class="label">Email for {person.name}</span>
										<input name="email" type="email" required placeholder="name@example.com" class="input w-full" />
									</label>
									<button class="btn-primary">Send invite</button>
									<button type="button" class="btn-ghost" onclick={() => (inviting = null)}>Cancel</button>
								</form>
								<p class="mt-2 text-xs text-slate-500">
									They will see only the trips they are driving, guiding or specialising on, and can update those. No bookings, no
									payments, no passports. This uses one of your plan's seats.
								</p>
							</li>
						{/if}
					{/each}
				</ul>
			</section>
		{/each}
		<p class="px-1 text-xs text-slate-400">
			People are deactivated rather than removed, so a trip that has already run still names whoever ran it.
		</p>
	{/if}
</div>
{/if}
