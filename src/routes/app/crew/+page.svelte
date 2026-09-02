<script lang="ts">
	import { enhance } from '$lib/forms';
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	import PeopleAccess from '$components/PeopleAccess.svelte';
	let { data, form } = $props();
	let inviting = $state<string | null>(null);
	let copied = $state(false);
	let showAdd = $state(false);

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

	const activeCrew = $derived(data.crew.filter((person) => person.isActive).length);
	const activeUsers = $derived(data.team.filter((member) => member.status === 'Active').length);

	const initials = (name: string) =>
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || '?';

	const ROLE_META: Record<string, { tone: string; surface: string }> = {
		DRIVER: {
			tone: 'text-brand-700',
			surface: 'bg-brand-100'
		},
		GUIDE: {
			tone: 'text-success',
			surface: 'bg-success/10'
		},
		SPECIALIST: {
			tone: 'text-purple',
			surface: 'bg-purple/10'
		}
	};
	const roleLabel = (type: string) => TYPES.find((role) => role.value === type)?.label ?? type;

	function openCrewForm() {
		showAdd = true;
		requestAnimationFrame(() =>
			document.getElementById('add-person')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
		);
	}
</script>

<svelte:head><title>People · {data.tenant.name}</title></svelte:head>

<!--
	The page itself is never gated on the trips module.

	The crew roster is a trips idea; app access is not, and Team used to live under
	Settings where it was always reachable. Hiding the whole page for a tenant that
	does not run departures would take user management away with it.
-->
<div class="w-full max-w-none space-y-7 pb-8">
	<section class="relative isolate overflow-hidden rounded-2xl bg-[#302820] px-5 py-6 text-white shadow-sm sm:px-7 sm:py-8">
		<div class="pointer-events-none absolute -top-24 -right-16 -z-10 size-72 rounded-full bg-brand-500/25 blur-3xl"></div>
		<div class="pointer-events-none absolute -bottom-32 left-1/3 -z-10 size-64 rounded-full bg-success/20 blur-3xl"></div>
		<div class="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
			<div class="max-w-2xl">
				<div class="mb-4 flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10">
					<svg class="size-6 text-brand-200" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
						<path d="M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-5 7a5 5 0 0 1 10 0M13 5.5a2 2 0 1 1 0 4M14 16a4.5 4.5 0 0 0-1.2-3" />
					</svg>
				</div>
				<p class="text-xs font-semibold tracking-[0.16em] text-brand-200 uppercase">People workspace</p>
				<h1 class="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">The people who move your business</h1>
				<p class="mt-2 max-w-xl text-sm leading-6 text-white/65">
					Keep your field crew ready for every departure and control who can sign in to Makutano Connect.
				</p>
			</div>
			<div class="flex flex-wrap gap-2">
				{#if data.canWrite}
					<button type="button" class="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-400" onclick={openCrewForm}>
						<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
						Add a person
					</button>
				{/if}
				{#if data.seesUsers}
					<a href="#app-access" class="inline-flex min-h-11 items-center rounded-xl border border-white/15 bg-white/8 px-4 text-sm font-medium text-white transition hover:bg-white/15">
						Manage app access
					</a>
				{/if}
			</div>
		</div>
		<div class="relative mt-7 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-5">
			<div><span class="text-xl font-bold tabular-nums">{activeCrew}</span><span class="ml-2 text-xs text-white/55">active field crew</span></div>
			{#if data.seesUsers}
				<div><span class="text-xl font-bold tabular-nums">{activeUsers}</span><span class="ml-2 text-xs text-white/55">active app users</span></div>
				<div><span class="text-xl font-bold tabular-nums">{data.workload.open_total}</span><span class="ml-2 text-xs text-white/55">open conversations</span></div>
			{/if}
		</div>
	</section>

	{#if !data.workspaceRelevant}
		<WorkspaceNotice module="Crew" />
	{/if}

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

	<section id="field-crew" class="scroll-mt-24 space-y-4">
		{#if data.canWrite}
			<div class="flex justify-end">
				<button type="button" class="btn-secondary !rounded-xl" onclick={() => (showAdd = !showAdd)}>
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d={showAdd ? 'M4 10h12' : 'M10 4v12M4 10h12'} /></svg>
					{showAdd ? 'Close form' : 'Add field crew'}
				</button>
			</div>
		{/if}

		{#if data.canWrite && showAdd}
			<form id="add-person" method="POST" action="?/create" use:enhance class="scroll-mt-24 overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/60 shadow-sm">
				<div class="flex items-start gap-3 border-b border-brand-100 px-4 py-4 sm:px-5">
					<div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white">
						<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
					</div>
					<div>
						<h3 class="text-sm font-bold text-slate-900">Add someone to the field crew</h3>
						<p class="mt-0.5 text-xs leading-5 text-slate-500">Start with the details dispatch needs. You can grant app access separately.</p>
					</div>
				</div>
				<div class="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
					<label class="block">
						<span class="label">Crew role</span>
						<select name="type" class="input w-full !rounded-xl">
							{#each TYPES as type}<option value={type.value}>{type.label}</option>{/each}
						</select>
					</label>
					<label class="block lg:col-span-2">
						<span class="label">Full name</span>
						<input name="name" required placeholder="e.g. Michael Mwakalinga" class="input w-full !rounded-xl" />
					</label>
					<label class="block">
						<span class="label">Phone number</span>
						<input name="phone" inputmode="tel" placeholder="+255 7•• ••• •••" class="input w-full !rounded-xl" />
					</label>
					<label class="block sm:col-span-2 lg:col-span-3">
						<span class="label">Licence or permit number <span class="font-normal text-slate-400">(optional)</span></span>
						<input name="licenceNumber" placeholder="Add a driver licence or guide permit" class="input w-full !rounded-xl" />
					</label>
					<div class="flex items-end justify-end"><button class="btn-primary w-full !rounded-xl sm:w-auto">Add to crew</button></div>
				</div>
			</form>
		{/if}

		{#if data.crew.length === 0}
			<div class="grid min-h-56 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/55 px-6 py-10 text-center">
				<div class="max-w-md">
					<div class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-success/10 text-success">
						<svg class="size-6" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 15c1.7-2.7 4-4 7-4s5.3 1.3 7 4M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /></svg>
					</div>
					<h3 class="mt-4 text-base font-bold text-slate-900">Build your go-to crew</h3>
					<p class="mt-1 text-sm leading-6 text-slate-500">Add the people you regularly dispatch so every trip has a known, reachable professional attached.</p>
					{#if data.canWrite && !showAdd}<button type="button" class="btn-primary mt-4 !rounded-xl" onclick={openCrewForm}>Add the first person</button>{/if}
				</div>
			</div>
		{:else}
			<div class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
				<div class="overflow-x-auto">
					<table class="min-w-[900px] w-full">
						<thead>
							<tr class="border-b border-slate-200 bg-slate-50">
								<th class="table-head">Person</th>
								<th class="table-head">Role</th>
								<th class="table-head">Contact</th>
								<th class="table-head">Licence / permit</th>
								<th class="table-head">App access</th>
								<th class="table-head">Status</th>
								{#if data.canWrite}<th class="table-head text-right">Actions</th>{/if}
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.crew as person (person.id)}
								{@const meta = ROLE_META[person.type]}
								<tr class="transition hover:bg-slate-50/70 {person.isActive ? '' : 'bg-slate-50/40 opacity-70'}">
									<td class="table-cell">
										<div class="flex items-center gap-3">
											<div class="grid size-9 shrink-0 place-items-center rounded-xl {meta.surface} text-xs font-bold {meta.tone}">{initials(person.name)}</div>
											<span class="font-semibold text-slate-900">{person.name}</span>
										</div>
									</td>
									<td class="table-cell"><span class="rounded-full px-2 py-1 text-xs font-semibold {meta.surface} {meta.tone}">{roleLabel(person.type)}</span></td>
									<td class="table-cell">
										{#if person.phone}
											<a href={`https://wa.me/${waNumber(person.phone)}`} target="_blank" rel="noreferrer noopener" class="font-medium text-success hover:underline">{person.phone}</a>
										{:else}<span class="text-slate-400">Not added</span>{/if}
									</td>
									<td class="table-cell">{person.licenceNumber || '—'}</td>
									<td class="table-cell">
										{#if person.userId}
											<span class="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700"><span class="size-1.5 rounded-full bg-brand-500"></span>Enabled</span>
										{:else if data.canWrite && data.canInvite && person.isActive}
											<button type="button" class="text-xs font-semibold text-brand-600 hover:underline" onclick={() => (inviting = person.id)}>Give access</button>
										{:else}<span class="text-slate-400">No access</span>{/if}
									</td>
									<td class="table-cell">
										<span class="inline-flex items-center gap-1.5 text-xs font-semibold {person.isActive ? 'text-success' : 'text-slate-400'}"><span class="size-1.5 rounded-full {person.isActive ? 'bg-success' : 'bg-slate-300'}"></span>{person.isActive ? 'Ready' : 'Inactive'}</span>
									</td>
									{#if data.canWrite}
										<td class="table-cell text-right">
											<form method="POST" action="?/toggle" use:enhance>
												<input type="hidden" name="id" value={person.id} />
												<input type="hidden" name="isActive" value={person.isActive ? 'off' : 'on'} />
												<button class="text-xs font-medium {person.isActive ? 'text-slate-400 hover:text-danger' : 'text-success hover:underline'}">{person.isActive ? 'Deactivate' : 'Reactivate'}</button>
											</form>
										</td>
									{/if}
								</tr>
								{#if inviting === person.id}
									<tr>
										<td colspan={data.canWrite ? 7 : 6} class="bg-brand-50/60 px-4 py-4">
											<form method="POST" action="?/invite" use:enhance class="flex flex-wrap items-end gap-2">
												<input type="hidden" name="id" value={person.id} />
												<label class="min-w-52 flex-1" for={`crew-email-${person.id}`}>
													<span class="label">Work email for {person.name}</span>
													<input id={`crew-email-${person.id}`} name="email" type="email" required placeholder="name@example.com" class="input w-full !rounded-xl" />
												</label>
												<button class="btn-primary !rounded-xl">Send invite</button>
												<button type="button" class="btn-secondary !rounded-xl" onclick={() => (inviting = null)}>Cancel</button>
											</form>
											<p class="mt-2 text-[11px] leading-5 text-slate-500">They can only see and update trips they are assigned to. This uses one plan seat.</p>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			</div>
			<p class="flex items-start gap-2 px-1 text-xs leading-5 text-slate-400">
				<svg class="mt-0.5 size-3.5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 9v5m0-8v.2" /></svg>
				People are deactivated instead of deleted, so completed trips always keep an accurate crew history.
			</p>
		{/if}
	</section>

	<!--
		App access.

		Absent, not disabled, for a viewer without members:read — a driver holds
		crew:read and nothing else, and an empty table they cannot explain is worse
		than no table at all.
	-->
	{#if data.seesUsers}
		<section id="app-access" class="scroll-mt-24 border-t border-slate-200 pt-7">
			<div class="mb-4">
				<p class="text-xs font-bold tracking-[0.14em] text-brand-600 uppercase">Workspace security</p>
				<h2 class="mt-1 text-xl font-bold tracking-tight text-slate-900">App access</h2>
				<p class="mt-1 max-w-2xl text-sm text-slate-500">Invite colleagues, choose what they can do, and spot accounts that still need attention.</p>
			</div>
			<PeopleAccess
				team={data.team}
				workload={data.workload}
				{form}
				canManage={data.canManageUsers}
				roleOptions={data.roleOptions}
				permissionGroups={data.permissionGroups}
				myUserId={data.myUserId}
				timezone={data.tenant.timezone}
			/>
		</section>
	{/if}
</div>
