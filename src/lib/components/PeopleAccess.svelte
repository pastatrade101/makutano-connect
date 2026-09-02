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
	const activeCount = $derived(team.filter((m) => m.status === 'Active').length);
	const pendingCount = $derived(team.filter((m) => m.status === 'Invited' || m.status === 'Invite expired').length);

	function startEdit(m: (typeof team)[number]) {
		editing = m.membershipId;
		draft = Object.fromEntries(permissionGroups.flatMap((g) => g.items.map((i) => [i.key, m.effective.includes(i.key)])));
		requestAnimationFrame(() =>
			document.getElementById('access-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		);
	}
	const STATUS_TONE: Record<string, string> = {
		Active: 'bg-success/10 text-success',
		Invited: 'bg-warning/10 text-warning',
		'Invite expired': 'bg-danger/10 text-danger',
		Deactivated: 'bg-slate-100 text-slate-500'
	};
	const ROLE_TONE: Record<string, string> = {
		OWNER: 'bg-brand-100 text-brand-800',
		ADMIN: 'bg-purple/10 text-purple',
		MANAGER: 'bg-info/10 text-slate-700',
		SALES: 'bg-success/10 text-success',
		CREW: 'bg-slate-100 text-slate-600'
	};
	const initials = (name: string | null, email: string) =>
		(name || email)
			.trim()
			.split(/[\s@]+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || '?';

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

<div class="space-y-4">
	<section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
			<div class="flex items-center gap-3">
				<div class="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
					<svg class="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 15h14M5 12V8m5 4V4m5 8V6" /></svg>
				</div>
				<div>
					<h3 class="text-sm font-bold text-slate-900">Team pulse</h3>
					<p class="text-xs text-slate-400">A quick read on access and shared workload</p>
				</div>
			</div>
			{#if canManage}
				<button class="btn-primary !rounded-xl" onclick={() => (showInvite = !showInvite)}>
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d={showInvite ? 'M4 10h12' : 'M12 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm-8 6a5 5 0 0 1 10 0m2-9v6m-3-3h6'} /></svg>
					{showInvite ? 'Close invite' : 'Invite colleague'}
				</button>
			{/if}
		</div>
		<div class="grid divide-y divide-slate-100 sm:grid-cols-5 sm:divide-x sm:divide-y-0">
			<div class="px-4 py-3 sm:col-span-2 sm:px-5">
				<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Workspace accounts</p>
				<div class="mt-1 flex items-baseline gap-2"><span class="text-2xl font-bold tabular-nums text-slate-900">{team.length}</span><span class="text-xs text-slate-500">{activeCount} active{pendingCount ? ` · ${pendingCount} pending` : ''}</span></div>
			</div>
			<div class="px-4 py-3">
				<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Open</p>
				<p class="mt-1 text-xl font-bold tabular-nums text-slate-900">{workload.open_total}</p>
			</div>
			<a href="/app/conversations?filter=unassigned" class="group px-4 py-3 transition hover:bg-brand-50">
				<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase group-hover:text-brand-600">Unassigned</p>
				<p class="mt-1 text-xl font-bold tabular-nums {workload.open_unassigned > 0 ? 'text-warning' : 'text-slate-900'}">{workload.open_unassigned}</p>
			</a>
			<div class="px-4 py-3">
				<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Replies today</p>
				<p class="mt-1 text-xl font-bold tabular-nums text-slate-900">{workload.replies_today}</p>
			</div>
		</div>
	</section>

	<!-- What actually happened, with a copyable fallback when email is unavailable. -->
	{#if form?.invited || form?.resent}
		<div class="rounded-2xl border border-success/20 bg-success/5 p-4">
			<div class="flex items-start gap-3">
				<div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-bold text-slate-900">{form?.resent ? 'A fresh invitation is ready' : 'Invitation created'}</p>
					<p class="mt-0.5 text-xs leading-5 {form?.emailed ? 'text-slate-500' : 'text-warning'}">
						{#if form?.emailed}
							Sent{form?.resentTo ? ` to ${form.resentTo}` : ''}. The link expires in 7 days.{form?.resent ? ' Any earlier link no longer works.' : ''}
						{:else}
							Email is not configured, so share this link directly. It expires in 7 days.
						{/if}
					</p>
					{#if form?.inviteLink}
						<div class="mt-3 flex flex-wrap items-center gap-2">
							<input class="input min-w-0 flex-1 !rounded-xl !py-2 font-mono text-[11.5px]" readonly value={form.inviteLink} onfocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
							<button type="button" class="btn-secondary !rounded-xl" onclick={() => copyLink(form.inviteLink)}>{copied ? 'Copied' : 'Copy link'}</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if showInvite && canManage}
		<form method="POST" action="?/inviteUser" use:enhance={() => async ({ update }) => { await update({ reset: true }); showInvite = false; }} class="overflow-hidden rounded-2xl border border-brand-200 bg-brand-50/60 shadow-sm">
			<div class="border-b border-brand-100 px-4 py-3 sm:px-5">
				<h3 class="text-sm font-bold text-slate-900">Invite someone into Connect</h3>
				<p class="mt-0.5 text-xs text-slate-500">Choose the closest role now. You can fine-tune permissions later.</p>
			</div>
			<div class="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-[1fr_1.35fr_1.15fr_auto]">
				<div><label class="label" for="i-name">Full name</label><input id="i-name" name="fullName" required class="input !rounded-xl" placeholder="Neema Joseph" /></div>
				<div><label class="label" for="i-email">Work email</label><input id="i-email" name="email" type="email" required class="input !rounded-xl" placeholder="neema@yourbusiness.com" /></div>
				<div>
					<label class="label" for="i-role">Starting role</label>
					<select id="i-role" name="role" class="input !rounded-xl">
						{#each roleOptions as role (role.value)}<option value={role.value} selected={role.value === 'SALES'}>{role.label} — {role.hint.toLowerCase()}</option>{/each}
					</select>
				</div>
				<div class="flex items-end"><button class="btn-primary w-full !rounded-xl">Send invite</button></div>
			</div>
		</form>
	{/if}

	<div class="grid gap-3 lg:grid-cols-2">
		{#each team as account (account.membershipId)}
			<article class="overflow-hidden rounded-2xl border bg-white shadow-sm transition {editing === account.membershipId ? 'border-brand-300 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'}">
				<div class="p-4 sm:p-5">
					<div class="flex items-start gap-3">
						<div class="grid size-11 shrink-0 place-items-center rounded-2xl {ROLE_TONE[account.role] || 'bg-slate-100 text-slate-600'} text-sm font-bold">{initials(account.fullName, account.email)}</div>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-sm font-bold text-slate-900">{account.fullName || account.email}</h3>
								{#if account.userId === myUserId}<span class="text-[10px] font-bold tracking-wide text-brand-600 uppercase">You</span>{/if}
								<span class="badge {STATUS_TONE[account.status]}">{account.status}</span>
							</div>
							<p class="mt-0.5 truncate text-xs text-slate-400">{account.email}</p>
							<div class="mt-2 flex flex-wrap items-center gap-2">
								<span class="rounded-full px-2 py-0.5 text-[11px] font-semibold {ROLE_TONE[account.role] || 'bg-slate-100 text-slate-600'}">{account.roleLabel}</span>
								{#if account.customized}<span class="text-[11px] font-medium text-purple">Custom access</span>{/if}
							</div>
						</div>
					</div>

					<div class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3">
						<div>
							<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Workload</p>
							<p class="mt-1 text-xs font-semibold text-slate-700">{account.assignedOpen} open · {account.repliesToday} replied today</p>
						</div>
						<div class="border-l border-slate-200 pl-3">
							<p class="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Last seen</p>
							<p class="mt-1 text-xs font-semibold text-slate-700">
								{#if account.lastActiveAt}<TimeAgo value={account.lastActiveAt} timezone={timezone} />{:else if account.inviteSentAt}Invited <TimeAgo value={account.inviteSentAt} timezone={timezone} />{:else}Never active{/if}
							</p>
						</div>
					</div>
				</div>

				{#if canManage}
					<div class="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 sm:px-5">
						{#if account.role === 'OWNER'}
							<p class="text-xs text-slate-400">Workspace owner · full access</p>
						{:else}
							<button class="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline" onclick={() => startEdit(account)}>
								<svg class="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M10 2.5 16 5v4.5c0 3.7-2.5 6.3-6 8-3.5-1.7-6-4.3-6-8V5l6-2.5Z" /><path d="M7.5 10 9 11.5l3.5-3.5" /></svg>
								Manage access
							</button>
							<div class="ml-auto flex flex-wrap justify-end gap-1.5">
								{#if account.status === 'Deactivated'}
									<form method="POST" action="?/setActive" use:enhance>
										<input type="hidden" name="membershipId" value={account.membershipId} /><input type="hidden" name="active" value="1" />
										<button class="btn-secondary !rounded-lg !px-2.5 !py-1.5 text-xs">Reactivate</button>
									</form>
									<form method="POST" action="?/removeUser" use:enhance>
										<input type="hidden" name="membershipId" value={account.membershipId} />
										<button class="px-2 py-1.5 text-xs text-slate-400 hover:text-danger">Remove</button>
									</form>
								{:else}
									{#if account.status === 'Invited' || account.status === 'Invite expired'}
										<form method="POST" action="?/resendInvite" use:enhance>
											<input type="hidden" name="membershipId" value={account.membershipId} />
											<button class="btn-secondary !rounded-lg !px-2.5 !py-1.5 text-xs">{account.status === 'Invite expired' ? 'New invite link' : 'Resend invite'}</button>
										</form>
									{/if}
									<button class="px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-danger" onclick={() => (deactivating = account.membershipId)}>Deactivate</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				{#if deactivating === account.membershipId}
					<form method="POST" action="?/setActive" use:enhance={() => async ({ update }) => { await update(); deactivating = null; }} class="space-y-3 border-t border-danger/20 bg-danger/5 p-4 sm:p-5">
						<input type="hidden" name="membershipId" value={account.membershipId} />
						<input type="hidden" name="active" value="0" />
						<p class="text-sm font-semibold text-slate-800">Deactivate {account.fullName || account.email}?</p>
						<p class="text-xs leading-5 text-slate-500">They lose access immediately, while their history stays intact.</p>
						{#if account.assignedOpen > 0}
							<div>
								<label class="label" for={`reassign-${account.membershipId}`}>Reassign {account.assignedOpen} open conversation{account.assignedOpen === 1 ? '' : 's'}</label>
								<select id={`reassign-${account.membershipId}`} name="reassignTo" class="input !rounded-xl">
									<option value="">Back to the team pool</option>
									{#each team.filter((candidate) => candidate.status === 'Active' && candidate.membershipId !== account.membershipId) as candidate (candidate.membershipId)}<option value={candidate.userId}>{candidate.fullName || candidate.email}</option>{/each}
								</select>
							</div>
						{/if}
						<div class="flex gap-2"><button class="btn-danger !rounded-xl">Deactivate account</button><button type="button" class="btn-secondary !rounded-xl" onclick={() => (deactivating = null)}>Keep active</button></div>
					</form>
				{/if}
			</article>
		{/each}
	</div>

	<!-- Per-member permission editor: role preset plus grouped overrides. -->
	{#if member && canManage}
		<section id="access-editor" class="scroll-mt-24 overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-md">
			<div class="flex flex-wrap items-start justify-between gap-3 bg-brand-50/70 px-4 py-4 sm:px-5">
				<div class="flex items-center gap-3">
					<div class="grid size-10 place-items-center rounded-xl {ROLE_TONE[member.role] || 'bg-slate-100 text-slate-600'} text-sm font-bold">{initials(member.fullName, member.email)}</div>
					<div>
						<p class="text-[10px] font-bold tracking-wider text-brand-600 uppercase">Access settings</p>
						<h3 class="text-sm font-bold text-slate-900">{member.fullName || member.email}</h3>
						<p class="text-xs text-slate-500">{member.customized ? `${member.roleLabel} with custom access` : `Using ${member.roleLabel} defaults`}</p>
					</div>
				</div>
				<button type="button" class="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700" onclick={() => (editing = null)} aria-label="Close access settings">
					<svg class="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
				</button>
			</div>

			<div class="border-t border-brand-100 p-4 sm:p-5">
				<div class="mb-5 flex flex-wrap items-end gap-2">
					<form method="POST" action="?/role" use:enhance class="flex flex-1 flex-wrap items-end gap-2">
						<input type="hidden" name="membershipId" value={member.membershipId} />
						<label class="min-w-44 flex-1"><span class="label">Role preset</span><select name="role" class="input !rounded-xl">{#each roleOptions as role (role.value)}<option value={role.value} selected={role.value === member.role}>{role.label}</option>{/each}</select></label>
						<button class="btn-secondary !rounded-xl">Change role</button>
					</form>
					<form method="POST" action="?/resetPermissions" use:enhance>
						<input type="hidden" name="membershipId" value={member.membershipId} />
						<button class="btn-secondary !rounded-xl">Use {member.roleLabel} defaults</button>
					</form>
				</div>

				<form method="POST" action="?/permissions" use:enhance={() => async ({ update }) => { await update(); }}>
					<input type="hidden" name="membershipId" value={member.membershipId} />
					<input type="hidden" name="overrides" value={JSON.stringify(draft)} />
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each permissionGroups as permissionGroup (permissionGroup.group)}
							<section class="rounded-xl border border-slate-200 p-3.5">
								<h4 class="mb-2.5 text-[11px] font-bold tracking-wider text-slate-500 uppercase">{permissionGroup.group}</h4>
								<div class="space-y-2">
									{#each permissionGroup.items as item (item.key)}
										<label class="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-slate-600">
											<input type="checkbox" bind:checked={draft[item.key]} class="mt-0.5 size-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
											<span>{item.label}</span>
										</label>
									{/each}
								</div>
							</section>
						{/each}
					</div>
					<div class="mt-4 flex justify-end"><button class="btn-primary !rounded-xl">Save custom access</button></div>
				</form>
			</div>
		</section>
	{/if}
</div>
