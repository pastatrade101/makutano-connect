<!--
	App access, as a component.

	Lifted out of /app/settings/team when Crew and Team became one People page.
	A component rather than a second copy: the invite banner, the resend button
	and the permission editor are fiddly enough that two copies would drift, and
	the pending-invite handling in here took a full audit to get right once.
-->
<script lang="ts">
	type Member = {
		membershipId: string; userId: string; fullName: string | null; email: string;
		role: string; roleLabel: string; status: string; customized: boolean;
		overrides: Record<string, boolean>; effective: string[];
		lastActiveAt: Date | string | null; inviteSentAt: Date | string | null;
		inviteExpiresAt: Date | string | null; assignedOpen: number; repliesToday: number;
	};
	type RoleOption = { readonly value: string; readonly label: string; readonly hint: string };
	type PermissionGroup = {
		readonly group: string;
		readonly items: readonly { readonly key: string; readonly label: string }[];
	};

	// The office roster: invite, role presets, grouped permission toggles, one-tap
	// deactivate with reassignment. Cards on phones, table on wide screens (§30).
	import { enhance } from '$lib/forms';
	import TimeAgo from '$components/TimeAgo.svelte';
	let {
		team,
		form,
		workload,
		canManage = false,
		roleOptions,
		permissionGroups,
		myUserId,
		timezone
	}: {
		team: Member[];
		form: Record<string, any> | null;
		workload: { open_total: number; open_unassigned: number; replies_today: number };
		canManage?: boolean;
		roleOptions: readonly RoleOption[];
		permissionGroups: readonly PermissionGroup[];
		myUserId: string;
		timezone: string;
	} = $props();

	let showInvite = $state(false);
	let editing = $state<string | null>(null);
	let deactivating = $state<string | null>(null);
	/** Working copy of the member being edited: permission key → granted. */
	let draft = $state<Record<string, boolean>>({});

	const member = $derived(team.find((m) => m.membershipId === editing) ?? null);

	function startEdit(m: (typeof team)[number]) {
		editing = m.membershipId;
		draft = Object.fromEntries(permissionGroups.flatMap((g) => g.items.map((i) => [i.key, m.effective.includes(i.key)])));
	}
	const STATUS_TONE: Record<string, string> = {
		Active: 'bg-success/10 text-success',
		Invited: 'bg-warning/10 text-warning',
		'Invite expired': 'bg-danger/10 text-danger',
		Deactivated: 'bg-slate-100 text-slate-500'
	};

	/** Copy-to-clipboard for the invite link, with a confirmation that fades. */
	let copied = $state(false);
	async function copyLink(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard denied (insecure context, or the user said no). The link is
			// on screen and selectable, so there is nothing to recover from.
		}
	}
</script>


{#if canManage}
	<div class="mb-3 flex justify-end">
		<button class="btn-primary" onclick={() => (showInvite = !showInvite)}>Invite a colleague</button>
	</div>
{/if}

	<!--
		What actually happened, not what we hope happened.

		This used to read "Invitation sent — they'll get an email" unconditionally,
		on a deployment that may have no mail provider at all. The link is shown
		either way, because email is the wrong channel for half the people invited
		here — a driver has WhatsApp, not an inbox he checks.
	-->
	{#if form?.invited || form?.resent}
		<div class="rounded-panel border border-slate-200 bg-white px-3 py-2.5">
			{#if form?.emailed}
				<p class="text-xs font-medium text-success">
					{form?.resent ? 'New invitation sent' : 'Invitation sent'}{form?.resentTo ? ` to ${form.resentTo}` : ''} — the
					link expires in 7 days.{form?.resent ? ' Any earlier link has stopped working.' : ''}
				</p>
			{:else}
				<p class="text-xs font-medium text-warning">
					Email is not configured on this deployment, so nothing was sent. Pass this link on
					yourself.
				</p>
			{/if}
			{#if form?.inviteLink}
				<div class="mt-2 flex items-center gap-2">
					<input
						class="input flex-1 !py-1.5 font-mono text-[11.5px]"
						readonly
						value={form.inviteLink}
						onfocus={(e) => e.currentTarget.select()}
						aria-label="Invitation link"
					/>
					<button
						type="button"
						class="btn-secondary !px-2.5 !py-1.5 text-[12.5px]"
						onclick={() => copyLink(form.inviteLink)}
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if showInvite && canManage}
		<form
			method="POST"
			action="?/inviteUser"
			use:enhance={() => async ({ update }) => { await update({ reset: true }); showInvite = false; }}
			class="card grid gap-3 p-4 sm:grid-cols-[1.5fr_2fr_1.5fr_auto]"
		>
			<div><label class="label" for="i-name">Name</label><input id="i-name" name="fullName" required class="input" placeholder="Neema Joseph" /></div>
			<div><label class="label" for="i-email">Email</label><input id="i-email" name="email" type="email" required class="input" placeholder="neema@yourbusiness.com" /></div>
			<div>
				<label class="label" for="i-role">Role</label>
				<select id="i-role" name="role" class="input">
					{#each roleOptions as r (r.value)}
						<option value={r.value} selected={r.value === 'SALES'}>{r.label} — {r.hint.toLowerCase()}</option>
					{/each}
				</select>
			</div>
			<div class="flex items-end"><button class="btn-primary w-full">Send invite</button></div>
		</form>
	{/if}

	<!-- Workload at a glance (§23): open threads, unassigned, per-person today -->
	<div class="grid grid-cols-3 gap-2">
		<div class="card px-3 py-2"><div class="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Open conversations</div><div class="text-lg font-bold tabular-nums text-slate-800">{workload.open_total}</div></div>
		<a href="/app/conversations?filter=unassigned" class="card px-3 py-2 transition hover:border-brand-300"><div class="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Unassigned</div><div class="text-lg font-bold tabular-nums {workload.open_unassigned > 0 ? 'text-warning' : 'text-slate-800'}">{workload.open_unassigned}</div></a>
		<div class="card px-3 py-2"><div class="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">Replies today</div><div class="text-lg font-bold tabular-nums text-slate-800">{workload.replies_today}</div></div>
	</div>

	<div class="card overflow-hidden">
		<!-- Phones: cards -->
		<ul class="divide-y divide-slate-100 sm:hidden">
			{#each team as m (m.membershipId)}
				<li class="space-y-2 p-3">
					<div class="flex items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-slate-800">{m.fullName || m.email}</p>
							<p class="truncate text-[12.5px] text-slate-400">{m.email}</p>
						</div>
						<span class="badge {STATUS_TONE[m.status]}">{m.status}</span>
					</div>
					<div class="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-500">
						<span class="badge bg-brand-50 text-brand-600">{m.roleLabel}{m.customized ? ' · Customized' : ''}</span>
						<span>{m.assignedOpen} open · {m.repliesToday} replies today</span>
						<span class="ml-auto">{#if m.lastActiveAt}<TimeAgo value={m.lastActiveAt} timezone={timezone} />{:else}Never active{/if}</span>
					</div>
					{#if canManage && m.role !== 'OWNER'}
						<div class="flex flex-wrap gap-1.5">
							<button class="btn-secondary !px-2.5 !py-1.5 text-[12.5px]" onclick={() => startEdit(m)}>Permissions</button>
							{#if m.status === 'Deactivated'}
								<form method="POST" action="?/setActive" use:enhance>
									<input type="hidden" name="membershipId" value={m.membershipId} /><input type="hidden" name="active" value="1" />
									<button class="btn-secondary !px-2.5 !py-1.5 text-[12.5px]">Reactivate</button>
								</form>
							{:else}
								<button class="btn-secondary !px-2.5 !py-1.5 text-[12.5px] text-danger" onclick={() => (deactivating = m.membershipId)}>Deactivate</button>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<!-- Wide screens: table -->
		<div class="hidden overflow-x-auto sm:block">
			<table class="min-w-full divide-y divide-slate-100">
				<thead class="bg-slate-50"><tr>
					<th class="table-head">Name</th><th class="table-head">Role</th><th class="table-head">Status</th>
					<th class="table-head">Open assigned</th><th class="table-head">Last active</th>
					{#if canManage}<th class="table-head text-right">Actions</th>{/if}
				</tr></thead>
				<tbody class="divide-y divide-slate-100">
					{#each team as m (m.membershipId)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell">
								<div class="font-medium text-slate-800">{m.fullName || '—'}</div>
								<div class="text-[12.5px] text-slate-400">{m.email}</div>
							</td>
							<td class="table-cell">
								<span class="badge bg-brand-50 text-brand-600">{m.roleLabel}</span>
								{#if m.customized}<span class="ml-1 text-[11.5px] text-slate-400">Customized</span>{/if}
							</td>
							<td class="table-cell"><span class="badge {STATUS_TONE[m.status]}">{m.status}</span></td>
							<td class="table-cell tabular-nums">{m.assignedOpen} <span class="text-[11.5px] text-slate-400">open</span> · {m.repliesToday} <span class="text-[11.5px] text-slate-400">today</span></td>
							<!-- For a pending invite, last-login is null forever. Showing when the
							     link was sent is the fact that actually helps. -->
							<td class="table-cell text-slate-500">
								{#if m.lastActiveAt}
									<TimeAgo value={m.lastActiveAt} timezone={timezone} />
								{:else if m.inviteSentAt}
									<span class="text-[12.5px]">
										Invited <TimeAgo value={m.inviteSentAt} timezone={timezone} />
									</span>
								{:else}
									—
								{/if}
							</td>
							{#if canManage}
								<td class="table-cell">
									{#if m.role !== 'OWNER'}
										<div class="flex justify-end gap-1.5">
											<button class="btn-secondary !px-2 !py-1 text-[12.5px]" onclick={() => startEdit(m)}>Permissions</button>
											{#if m.status === 'Deactivated'}
												<form method="POST" action="?/setActive" use:enhance>
													<input type="hidden" name="membershipId" value={m.membershipId} /><input type="hidden" name="active" value="1" />
													<button class="btn-secondary !px-2 !py-1 text-[12.5px]">Reactivate</button>
												</form>
												<form method="POST" action="?/removeUser" use:enhance>
													<input type="hidden" name="membershipId" value={m.membershipId} />
													<button class="!px-2 !py-1 text-[12.5px] text-slate-400 hover:text-danger hover:underline">Remove</button>
												</form>
											{:else}
												{#if m.status === 'Invited' || m.status === 'Invite expired'}
													<!-- The only route out of a stuck invite used to be Remove and
													     re-invite, and Remove deletes the membership along with its
													     permission overrides. -->
													<form method="POST" action="?/resendInvite" use:enhance>
														<input type="hidden" name="membershipId" value={m.membershipId} />
														<button class="btn-secondary !px-2 !py-1 text-[12.5px]">
															{m.status === 'Invite expired' ? 'Send a new link' : 'Resend invite'}
														</button>
													</form>
												{/if}
												<button class="btn-secondary !px-2 !py-1 text-[12.5px] text-danger" onclick={() => (deactivating = m.membershipId)}>Deactivate</button>
											{/if}
										</div>
									{:else}
										<div class="text-right text-[11.5px] text-slate-400">Owner — full access</div>
									{/if}
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Deactivate with reassignment (§24, §36) -->
	{#if deactivating}
		{@const target = team.find((t) => t.membershipId === deactivating)}
		<form method="POST" action="?/setActive" use:enhance={() => async ({ update }) => { await update(); deactivating = null; }} class="card space-y-3 border-danger/30 p-4">
			<input type="hidden" name="membershipId" value={deactivating} />
			<input type="hidden" name="active" value="0" />
			<p class="text-sm text-slate-700">
				Deactivate <b>{target?.fullName || target?.email}</b>? They lose access immediately; their history stays.
			</p>
			{#if (target?.assignedOpen ?? 0) > 0}
				<div>
					<label class="label" for="reassign">Reassign their {target?.assignedOpen} open conversation{target?.assignedOpen === 1 ? '' : 's'} to</label>
					<select id="reassign" name="reassignTo" class="input w-auto">
						<option value="">— back to the team pool —</option>
						{#each team.filter((t) => t.status === 'Active' && t.membershipId !== deactivating) as t (t.membershipId)}
							<option value={t.userId}>{t.fullName || t.email}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex gap-2">
				<button class="btn-danger">Deactivate</button>
				<button type="button" class="btn-secondary" onclick={() => (deactivating = null)}>Cancel</button>
			</div>
		</form>
	{/if}

	<!-- Per-member permission editor (§10-§11): role preset + grouped toggles -->
	{#if member && canManage}
		<div class="card p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="text-sm font-semibold text-slate-800">{member.fullName || member.email}</h2>
					<p class="text-[12.5px] text-slate-400">
						{member.customized ? `${member.roleLabel} · Customized` : `Using ${member.roleLabel} defaults`}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<form method="POST" action="?/role" use:enhance class="flex items-center gap-1.5">
						<input type="hidden" name="membershipId" value={member.membershipId} />
						<select name="role" class="input w-auto !py-1.5 text-xs">
							{#each roleOptions as r (r.value)}
								<option value={r.value} selected={r.value === member.role}>{r.label}</option>
							{/each}
						</select>
						<button class="btn-secondary !py-1.5 text-xs">Change role</button>
					</form>
					<form method="POST" action="?/resetPermissions" use:enhance>
						<input type="hidden" name="membershipId" value={member.membershipId} />
						<button class="btn-secondary !py-1.5 text-xs">Reset to {member.roleLabel} defaults</button>
					</form>
					<button class="text-xs text-slate-400 hover:underline" onclick={() => (editing = null)}>Close</button>
				</div>
			</div>

			<form
				method="POST"
				action="?/permissions"
				use:enhance={() => async ({ update }) => { await update(); }}
			>
				<input type="hidden" name="membershipId" value={member.membershipId} />
				<input type="hidden" name="overrides" value={JSON.stringify(draft)} />
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each permissionGroups as group (group.group)}
						<section class="rounded-panel border border-slate-200 p-3">
							<h3 class="mb-2 text-[12.5px] font-bold tracking-wide text-slate-500 uppercase">{group.group}</h3>
							<div class="space-y-1.5">
								{#each group.items as item (item.key)}
									<label class="flex items-start gap-2 text-xs text-slate-600">
										<input type="checkbox" bind:checked={draft[item.key]} class="mt-0.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
										<span>{item.label}</span>
									</label>
								{/each}
							</div>
						</section>
					{/each}
				</div>
				<div class="mt-3 flex justify-end">
					<button class="btn-primary">Save permissions</button>
				</div>
			</form>
		</div>
	{/if}
