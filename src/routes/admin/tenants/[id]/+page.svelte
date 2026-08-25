<script lang="ts">
	import { WORKSPACE_OPTIONS, normalizeWorkspace } from '$lib/workspace';
	// Tenant Control Center — the operational view of one tenant: what it is, what it
	// may do, what it has used, and the levers to change all three.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	const suspended = $derived(data.tenant.status === 'SUSPENDED');
	const tenantWorkspace = $derived(normalizeWorkspace((data.tenant.settings as Record<string, unknown>)?.capabilities));
	let confirming = $state<string | null>(null);
	let editingKey = $state<string | null>(null);

	const groups = $derived.by(() => {
		const map = new Map<string, typeof data.entitlementRows>();
		for (const row of data.entitlementRows) {
			const g = row.definition.group;
			if (!map.has(g)) map.set(g, []);
			map.get(g)!.push(row);
		}
		return [...map.entries()];
	});

	const show = (v: boolean | number | null, kind: string) =>
		v === null ? '—' : kind === 'boolean' ? (v ? 'Enabled' : 'Disabled') : Number(v) === 0 ? 'Unlimited' : String(v);
</script>

<svelte:head><title>{data.tenant.name} · Control Center</title></svelte:head>

<FormToast {form} successTitle="Tenant updated" />

<div class="space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<a href="/admin/tenants" class="text-xs text-slate-500 hover:underline">← Tenants</a>
			<h1 class="flex items-center gap-2 text-base font-semibold text-slate-800">
				{data.tenant.name}
				<StatusBadge value={data.tenant.status} />
				<span class="badge bg-brand-50 text-brand-600">{data.plan?.code ?? 'NO PLAN'}</span>
			</h1>
			<p class="font-mono text-[12.5px] text-slate-400">{data.tenant.slug} · created <TimeAgo value={data.tenant.createdAt} /></p>
		</div>
		<div class="flex items-center gap-2">
			{#if suspended}
				<form method="POST" action="?/status" use:enhance>
					<input type="hidden" name="status" value="ACTIVE" />
					<button class="btn-primary">Reactivate tenant</button>
				</form>
			{:else if confirming === 'suspend'}
				<form method="POST" action="?/status" use:enhance={() => async ({ update }) => { await update(); confirming = null; }} class="flex items-center gap-2 rounded-panel border border-danger/30 bg-danger/5 p-2">
					<input type="hidden" name="status" value="SUSPENDED" />
					<input name="reason" placeholder="Reason (audited)" class="input w-48 py-1 text-xs" />
					<button class="btn-danger !py-1 text-xs">Confirm suspend</button>
					<button type="button" class="text-xs text-slate-500" onclick={() => (confirming = null)}>Cancel</button>
				</form>
			{:else}
				<button class="btn-danger" onclick={() => (confirming = 'suspend')}>Suspend tenant</button>
			{/if}
		</div>
	</div>

	{#if suspended}
		<p class="rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">
			This tenant is suspended — writes (API, orders, bookings, WhatsApp sends, form submissions) are blocked. Data is intact and readable.
		</p>
	{/if}

	<!-- Where this account came from, and who is behind it -->
	<section class="card p-4">
		<h2 class="card-title mb-3">Account origin</h2>
		<dl class="grid gap-x-6 gap-y-2.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
			<div>
				<dt class="text-slate-400">Provisioned via</dt>
				<dd class="mt-0.5">
					<span
						class="badge {data.tenant.provisioningSource === 'SELF_SERVICE'
							? 'bg-purple/10 text-purple'
							: 'bg-slate-100 text-slate-600'}"
					>
						{data.tenant.provisioningSource === 'SELF_SERVICE'
							? 'Self-service signup'
							: data.tenant.provisioningSource === 'IMPORT'
								? 'Legacy import'
								: 'Platform Admin'}
					</span>
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Owner</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if data.owner}
						{data.owner.email}
						{#if !data.owner.emailVerifiedAt}
							<span class="badge ml-1 bg-warning/15 text-[#b58514]">unverified</span>
						{/if}
					{:else}
						<span class="text-slate-400">No owner assigned</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Industry</dt>
				<dd class="mt-0.5 font-medium text-slate-700">{data.industryLabel ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-slate-400">Workspace</dt>
				<dd class="mt-0.5">
					<form method="POST" action="?/workspace" use:enhance class="flex items-center gap-1.5">
						<select name="workspace" class="input w-auto !py-1 text-xs">
							{#each WORKSPACE_OPTIONS as opt (opt.value)}
								<option value={opt.value} selected={tenantWorkspace === opt.value}>{opt.label}</option>
							{/each}
						</select>
						<button class="btn-secondary !px-2 !py-1 text-[12.5px]">Save</button>
					</form>
					<p class="mt-0.5 text-[11.5px] text-slate-400">UI relevance only — plan entitlements still decide access.</p>
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Onboarding</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if data.tenant.onboardingCompletedAt}
						Completed <TimeAgo value={data.tenant.onboardingCompletedAt} />
					{:else}
						<span class="text-slate-500">In progress</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Business phone</dt>
				<dd class="mt-0.5 font-medium text-slate-700">{data.tenant.businessPhone ?? '—'}</dd>
			</div>
			<div>
				<dt class="text-slate-400">Website</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if data.tenant.websiteUrl}
						<a href={data.tenant.websiteUrl} rel="noreferrer noopener" target="_blank" class="text-brand-600 hover:underline">
							{data.tenant.websiteUrl}
						</a>
					{:else}—{/if}
				</dd>
			</div>
			<div>
				<dt class="text-slate-400">Country / currency</dt>
				<dd class="mt-0.5 font-medium text-slate-700">{data.tenant.country ?? '—'} · {data.tenant.currency}</dd>
			</div>
			<div>
				<dt class="text-slate-400">Owner last signed in</dt>
				<dd class="mt-0.5 font-medium text-slate-700">
					{#if data.owner?.lastLoginAt}<TimeAgo value={data.owner.lastLoginAt} />{:else}Never{/if}
				</dd>
			</div>
		</dl>
	</section>

	<!-- Overview counters -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
		{#each [['Members', data.counts.members], ['API keys', data.counts.api_keys], ['Customers', data.counts.customers], ['Requests', data.counts.booking_requests], ['Orders', data.counts.orders], ['Forms', data.counts.forms], ['Webhooks', data.counts.webhooks], ['Templates', data.counts.templates]] as [label, value] (label)}
			<div class="card px-3 py-2">
				<div class="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
				<div class="text-lg font-bold tabular-nums text-slate-800">{value ?? 0}</div>
			</div>
		{/each}
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<!-- Features & limits -->
		<section class="card lg:col-span-2">
			<header class="card-header">
				<h2 class="card-title">Features &amp; limits</h2>
				<span class="text-[12.5px] text-slate-400">Effective = override, else plan default</span>
			</header>
			<div class="overflow-x-auto">
				<table class="min-w-[720px] divide-y divide-slate-100 sm:min-w-full">
					<thead class="bg-slate-50">
						<tr><th class="table-head">Feature</th><th class="table-head">Plan default</th><th class="table-head">Override</th><th class="table-head">Effective</th><th class="table-head"></th></tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each groups as [group, rows] (group)}
							<tr class="bg-slate-50/60"><td colspan="5" class="px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-widest text-slate-400">{group}</td></tr>
							{#each rows as row (row.key)}
								<tr class={row.override !== null ? 'bg-brand-50/30' : ''}>
									<td class="table-cell">
										<div class="font-medium text-slate-700">{row.definition.label}</div>
										<div class="font-mono text-[12px] text-slate-400">{row.key}</div>
									</td>
									<td class="table-cell text-slate-500">{show(row.planValue, row.definition.kind)}</td>
									<td class="table-cell">
										{#if row.override !== null}
											<span class="badge bg-brand-50 text-brand-600">{show(row.override, row.definition.kind)}</span>
										{:else}
											<span class="text-slate-300">—</span>
										{/if}
									</td>
									<td class="table-cell font-semibold text-slate-800">{show(row.effective, row.definition.kind)}</td>
									<td class="table-cell text-right whitespace-nowrap">
										{#if editingKey === row.key}
											<form method="POST" action="?/override" use:enhance={() => async ({ update }) => { await update(); editingKey = null; }} class="inline-flex items-center gap-1">
												<input type="hidden" name="key" value={row.key} />
												<input type="hidden" name="kind" value={row.definition.kind} />
												{#if row.definition.kind === 'boolean'}
													<select name="value" class="input w-auto py-1 text-xs"><option value="true">Enabled</option><option value="false">Disabled</option></select>
												{:else}
													<input name="value" type="number" min="0" value={String(row.effective)} class="input w-24 py-1 text-xs" title="0 = unlimited" />
												{/if}
												<button class="text-xs font-medium text-brand-600 hover:underline">Save</button>
												<button type="button" class="text-xs text-slate-400" onclick={() => (editingKey = null)}>✕</button>
											</form>
										{:else}
											<button class="text-xs text-brand-600 hover:underline" onclick={() => (editingKey = row.key)}>Override</button>
											{#if row.override !== null}
												<form method="POST" action="?/resetOverride" use:enhance class="ml-2 inline">
													<input type="hidden" name="key" value={row.key} />
													<button class="text-xs text-slate-400 hover:text-danger hover:underline" title="Inherit from plan again">Reset</button>
												</form>
											{/if}
										{/if}
									</td>
								</tr>
							{/each}
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<div class="space-y-4">
			<!-- Subscription -->
			<section class="card">
				<header class="card-header"><h2 class="card-title">Subscription</h2></header>
				<div class="space-y-2 p-4 text-sm">
					{#if data.subscription}
						<div class="flex justify-between"><span class="text-slate-500">Plan</span><span class="font-medium">{data.subscription.plan.name}</span></div>
						<div class="flex justify-between"><span class="text-slate-500">Status</span><StatusBadge value={data.subscription.subscription.status} size="xs" /></div>
						<div class="flex justify-between"><span class="text-slate-500">Period start</span><span>{new Date(data.subscription.subscription.currentPeriodStart).toLocaleDateString('en-GB')}</span></div>
						<div class="flex justify-between"><span class="text-slate-500">Period end</span><span>{new Date(data.subscription.subscription.currentPeriodEnd).toLocaleDateString('en-GB')}</span></div>
						<div class="flex justify-between"><span class="text-slate-500">Renews</span><span>{data.subscription.subscription.cancelAtPeriodEnd ? 'No — cancels at period end' : 'Yes'}</span></div>
					{:else}
						<p class="text-xs text-slate-400">No subscription record.</p>
					{/if}
				</div>
				<div class="space-y-2 border-t border-slate-100 p-3">
					<form method="POST" action="?/plan" use:enhance class="flex items-center gap-2">
						<select name="planId" class="input py-1.5 text-xs">
							{#each data.plans as p (p.id)}<option value={p.id} selected={p.id === data.tenant.planId}>{p.name}</option>{/each}
						</select>
						<button class="btn-secondary !py-1.5 text-xs">Change plan</button>
					</form>
					{#if data.subscription}
						<form method="POST" action="?/subscription" use:enhance class="flex items-center gap-2">
							<select name="status" class="input py-1.5 text-xs">
								{#each ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED'] as s (s)}
									<option value={s} selected={data.subscription.subscription.status === s}>{s}</option>
								{/each}
							</select>
							<input name="extendDays" type="number" min="0" placeholder="+days" class="input w-20 py-1.5 text-xs" />
							<button class="btn-secondary !py-1.5 text-xs">Apply</button>
						</form>
					{/if}
				</div>
			</section>

			<!-- Usage vs limits -->
			<section class="card">
				<header class="card-header"><h2 class="card-title">Usage this period</h2></header>
				<div class="space-y-2.5 p-4">
					{#each data.usage as u (u.key)}
						<div>
							<div class="flex justify-between text-xs">
								<span class="text-slate-600">{u.label}</span>
								<span class="tabular-nums text-slate-500">{u.used}{u.unlimited ? '' : ` / ${u.limit}`}</span>
							</div>
							{#if !u.unlimited}
								<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
									<div class="h-full rounded-full {u.percent >= 100 ? 'bg-danger' : u.percent >= 80 ? 'bg-warning' : 'bg-brand-500'}" style="width: {u.percent}%"></div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</section>

			<!-- WhatsApp -->
			<section class="card">
				<header class="card-header"><h2 class="card-title">WhatsApp</h2></header>
				<ul class="divide-y divide-slate-100">
					{#each data.connections as c (c.id)}
						<li class="px-4 py-2.5 text-sm">
							<div class="flex items-center justify-between">
								<a href="/admin/whatsapp/{c.id}" class="font-medium text-brand-600 hover:underline">{c.displayPhoneNumber ?? c.phoneNumberId}</a>
								<StatusBadge value={c.status} size="xs" />
							</div>
							<div class="text-[12.5px] text-slate-400">last inbound <TimeAgo value={c.lastWebhookAt} /> · last send <TimeAgo value={c.lastSuccessfulSendAt} /></div>
						</li>
					{:else}
						<li class="px-4 py-6 text-center text-xs text-slate-400">No connected number.</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>

	<div class="grid gap-4 lg:grid-cols-2">
		<section class="card">
			<header class="card-header"><h2 class="card-title">Recent errors</h2></header>
			<ul class="divide-y divide-slate-100">
				{#each data.recentErrors as e, i (i)}
					<li class="px-4 py-2 text-xs">
						<span class="badge bg-slate-100 text-[11.5px] uppercase text-slate-500">{e.kind}</span>
						<span class="ml-2 text-slate-600">{e.detail}</span>
						<div class="mt-0.5 truncate text-danger">{e.message ?? '—'}</div>
						<div class="text-slate-400"><TimeAgo value={e.created_at as string} /></div>
					</li>
				{:else}
					<li class="px-4 py-6 text-center text-xs text-slate-400">No recent failures.</li>
				{/each}
			</ul>
		</section>

		<section class="card">
			<header class="card-header"><h2 class="card-title">Recent activity</h2></header>
			<ul class="divide-y divide-slate-100">
				{#each data.recentAudit as row (row.log.id)}
					<li class="flex items-center justify-between px-4 py-2 text-xs">
						<span class="font-mono text-slate-600">{row.log.action}</span>
						<span class="text-slate-400">{row.user?.email ?? row.log.actorType} · <TimeAgo value={row.log.createdAt} /></span>
					</li>
				{:else}
					<li class="px-4 py-6 text-center text-xs text-slate-400">No activity yet.</li>
				{/each}
			</ul>
		</section>
	</div>
</div>
