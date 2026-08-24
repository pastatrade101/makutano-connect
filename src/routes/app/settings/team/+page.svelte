<script lang="ts">
	// The office roster: invite, role presets, grouped permission toggles, one-tap
	// deactivate with reassignment. Cards on phones, table on wide screens (§30).
	import { enhance } from '$app/forms';
	import FormToast from '$components/FormToast.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	let showInvite = $state(false);
	let editing = $state<string | null>(null);
	let deactivating = $state<string | null>(null);
	/** Working copy of the member being edited: permission key → granted. */
	let draft = $state<Record<string, boolean>>({});

	const member = $derived(data.team.find((m) => m.membershipId === editing) ?? null);

	function startEdit(m: (typeof data.team)[number]) {
		editing = m.membershipId;
		draft = Object.fromEntries(data.permissionGroups.flatMap((g) => g.items.map((i) => [i.key, m.effective.includes(i.key)])));
	}
	const STATUS_TONE: Record<string, string> = {
		Active: 'bg-success/10 text-success',
		Invited: 'bg-warning/10 text-warning',
		Deactivated: 'bg-slate-100 text-slate-500'
	};
</script>

<svelte:head><title>Team · {data.tenant.name}</title></svelte:head>

<FormToast {form} successTitle="Saved" />

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<div>
			<a href="/app/settings" class="text-xs text-slate-500 hover:underline">← Settings</a>
			<h1 class="text-base font-semibold text-slate-900">Team</h1>
		</div>
		{#if data.canManage}
			<button class="btn-primary" onclick={() => (showInvite = !showInvite)}>Invite team member</button>
		{/if}
	</div>

	{#if form?.invited}
		<p class="rounded-panel bg-success/10 px-3 py-2 text-xs text-success">
			Invitation sent — they'll get an email with a link that expires in 7 days.
		</p>
	{/if}

	{#if showInvite && data.canManage}
		<form
			method="POST"
			action="?/invite"
			use:enhance={() => async ({ update }) => { await update({ reset: true }); showInvite = false; }}
			class="card grid gap-3 p-4 sm:grid-cols-[1.5fr_2fr_1.5fr_auto]"
		>
			<div><label class="label" for="i-name">Name</label><input id="i-name" name="fullName" required class="input" placeholder="Neema Joseph" /></div>
			<div><label class="label" for="i-email">Email</label><input id="i-email" name="email" type="email" required class="input" placeholder="neema@yourbusiness.com" /></div>
			<div>
				<label class="label" for="i-role">Role</label>
				<select id="i-role" name="role" class="input">
					{#each data.roleOptions as r (r.value)}
						<option value={r.value} selected={r.value === 'SALES'}>{r.label} — {r.hint.toLowerCase()}</option>
					{/each}
				</select>
			</div>
			<div class="flex items-end"><button class="btn-primary w-full">Send invite</button></div>
		</form>
	{/if}

	<div class="card overflow-hidden">
		<!-- Phones: cards -->
		<ul class="divide-y divide-slate-100 sm:hidden">
			{#each data.team as m (m.membershipId)}
				<li class="space-y-2 p-3">
					<div class="flex items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-slate-800">{m.fullName || m.email}</p>
							<p class="truncate text-[11px] text-slate-400">{m.email}</p>
						</div>
						<span class="badge {STATUS_TONE[m.status]}">{m.status}</span>
					</div>
					<div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
						<span class="badge bg-brand-50 text-brand-600">{m.roleLabel}{m.customized ? ' · Customized' : ''}</span>
						<span>{m.assignedOpen} open assigned</span>
						<span class="ml-auto">{#if m.lastActiveAt}<TimeAgo value={m.lastActiveAt} timezone={data.tenant.timezone} />{:else}Never active{/if}</span>
					</div>
					{#if data.canManage && m.role !== 'OWNER'}
						<div class="flex flex-wrap gap-1.5">
							<button class="btn-secondary !px-2.5 !py-1.5 text-[11px]" onclick={() => startEdit(m)}>Permissions</button>
							{#if m.status === 'Deactivated'}
								<form method="POST" action="?/setActive" use:enhance>
									<input type="hidden" name="membershipId" value={m.membershipId} /><input type="hidden" name="active" value="1" />
									<button class="btn-secondary !px-2.5 !py-1.5 text-[11px]">Reactivate</button>
								</form>
							{:else}
								<button class="btn-secondary !px-2.5 !py-1.5 text-[11px] text-danger" onclick={() => (deactivating = m.membershipId)}>Deactivate</button>
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
					{#if data.canManage}<th class="table-head text-right">Actions</th>{/if}
				</tr></thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.team as m (m.membershipId)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell">
								<div class="font-medium text-slate-800">{m.fullName || '—'}</div>
								<div class="text-[11px] text-slate-400">{m.email}</div>
							</td>
							<td class="table-cell">
								<span class="badge bg-brand-50 text-brand-600">{m.roleLabel}</span>
								{#if m.customized}<span class="ml-1 text-[10px] text-slate-400">Customized</span>{/if}
							</td>
							<td class="table-cell"><span class="badge {STATUS_TONE[m.status]}">{m.status}</span></td>
							<td class="table-cell tabular-nums">{m.assignedOpen}</td>
							<td class="table-cell text-slate-500">{#if m.lastActiveAt}<TimeAgo value={m.lastActiveAt} timezone={data.tenant.timezone} />{:else}—{/if}</td>
							{#if data.canManage}
								<td class="table-cell">
									{#if m.role !== 'OWNER'}
										<div class="flex justify-end gap-1.5">
											<button class="btn-secondary !px-2 !py-1 text-[11px]" onclick={() => startEdit(m)}>Permissions</button>
											{#if m.status === 'Deactivated'}
												<form method="POST" action="?/setActive" use:enhance>
													<input type="hidden" name="membershipId" value={m.membershipId} /><input type="hidden" name="active" value="1" />
													<button class="btn-secondary !px-2 !py-1 text-[11px]">Reactivate</button>
												</form>
												<form method="POST" action="?/remove" use:enhance>
													<input type="hidden" name="membershipId" value={m.membershipId} />
													<button class="!px-2 !py-1 text-[11px] text-slate-400 hover:text-danger hover:underline">Remove</button>
												</form>
											{:else}
												<button class="btn-secondary !px-2 !py-1 text-[11px] text-danger" onclick={() => (deactivating = m.membershipId)}>Deactivate</button>
											{/if}
										</div>
									{:else}
										<div class="text-right text-[10px] text-slate-400">Owner — full access</div>
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
		{@const target = data.team.find((t) => t.membershipId === deactivating)}
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
						{#each data.team.filter((t) => t.status === 'Active' && t.membershipId !== deactivating) as t (t.membershipId)}
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
	{#if member && data.canManage}
		<div class="card p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 class="text-sm font-semibold text-slate-800">{member.fullName || member.email}</h2>
					<p class="text-[11px] text-slate-400">
						{member.customized ? `${member.roleLabel} · Customized` : `Using ${member.roleLabel} defaults`}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<form method="POST" action="?/role" use:enhance class="flex items-center gap-1.5">
						<input type="hidden" name="membershipId" value={member.membershipId} />
						<select name="role" class="input w-auto !py-1.5 text-xs">
							{#each data.roleOptions as r (r.value)}
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
					{#each data.permissionGroups as group (group.group)}
						<section class="rounded-panel border border-slate-200 p-3">
							<h3 class="mb-2 text-[11px] font-bold tracking-wide text-slate-500 uppercase">{group.group}</h3>
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
</div>
