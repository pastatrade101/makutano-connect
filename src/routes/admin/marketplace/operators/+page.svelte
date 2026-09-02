<script lang="ts">
	// The verification desk. One row per operator, sorted by what a delay actually
	// costs — an unverified company with listings already live is the top of the list.
	import { enhance } from '$app/forms';
	import EmptyState from '$components/EmptyState.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';

	let { data, form } = $props();

	// Withdrawing a badge is not the same kind of act as granting one, so it asks.
	// Granting does not: the whole point of the queue is that saying yes is one click.
	let withdrawing = $state<string | null>(null);

	const href = (tab: string) =>
		`/admin/marketplace/operators?tab=${tab}${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}`;
</script>

<svelte:head><title>Operator verification · Makutano Admin</title></svelte:head>

<div class="space-y-3">
	<div>
		<h1 class="text-base font-semibold text-slate-900">Operator verification</h1>
		<p class="mt-0.5 text-xs text-slate-500">
			The badge is the marketplace vouching for a company, so it is ours to give. Listing counts
			show what is already public behind each decision.
		</p>
	</div>

	{#if form?.message}
		<p class="rounded-panel border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{form.message}</p>
	{:else if form?.success}
		<p class="rounded-panel border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
			{form.verified ? `${form.name} is now a verified operator.` : `Verification withdrawn from ${form.name}.`}
		</p>
	{/if}

	<!-- The one number worth putting above the table: listings the public can already
	     book from a company nobody has checked. Silent when it is zero, because a
	     banner that is always there stops being read. -->
	{#if data.liveWithoutBadge > 0}
		<p class="rounded-panel border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-slate-700">
			<span class="font-semibold text-warning">{data.liveWithoutBadge}</span>
			{data.liveWithoutBadge === 1 ? 'listing is' : 'listings are'} live on the marketplace from operators who have not been verified.
		</p>
	{/if}

	<nav class="flex flex-wrap items-center gap-1 rounded-panel bg-slate-100 p-1">
		{#each data.tabs as t (t.key)}
			<a
				href={href(t.key)}
				class="flex items-center gap-1.5 rounded-panel px-3 py-1.5 text-sm font-medium transition {data.tab === t.key
					? 'bg-white text-slate-900 shadow-panel'
					: 'text-slate-500 hover:text-slate-700'}"
			>
				{t.label}
				<span
					class="rounded-full px-1.5 py-0.5 text-[11px] tabular-nums {t.key === 'missing' && t.count > 0
						? 'bg-danger/10 text-danger'
						: 'bg-slate-200/70 text-slate-600'}">{t.count}</span
				>
			</a>
		{/each}
	</nav>

	<form method="GET" class="card flex flex-wrap items-end gap-3 p-3">
		<input type="hidden" name="tab" value={data.tab} />
		<div class="min-w-[220px] flex-1">
			<label class="label" for="q">Search</label>
			<input id="q" name="q" value={data.q} placeholder="Operator, slug or owner email" class="input" />
		</div>
		<button class="btn-secondary">Filter</button>
		{#if data.q}
			<a href={`/admin/marketplace/operators?tab=${data.tab}`} class="text-xs text-slate-500 hover:underline">Clear</a>
		{/if}
	</form>

	<div class="card overflow-hidden">
		<div class="overflow-x-auto">
			<table class="min-w-[880px] divide-y divide-slate-100 sm:min-w-full">
				<thead class="bg-slate-50">
					<tr>
						<th class="table-head">Operator</th>
						<th class="table-head">Account</th>
						<th class="table-head">Listings</th>
						<th class="table-head">Profile</th>
						<!-- Spelled out. The operators list calls the owner's email confirmation
						     "unverified", which is a different claim entirely from this page's. -->
						<th class="table-head">Owner email</th>
						<th class="table-head"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.rows as row (row.tenantId)}
						<tr class="hover:bg-slate-50">
							<td class="table-cell">
								<div class="flex items-center gap-2.5">
									{#if row.logoUrl}
										<img src={row.logoUrl} alt="" class="size-9 shrink-0 rounded-panel border border-slate-200 bg-white object-contain" />
									{:else}
										<!-- An operator with no mark is a fact worth seeing on a page about
										     whether to vouch for them, so the placeholder carries their
										     initial rather than being an empty grey square. -->
										<span class="flex size-9 shrink-0 items-center justify-center rounded-panel border border-dashed border-slate-300 text-xs font-semibold text-slate-400">
											{row.name.trim().charAt(0).toUpperCase()}
										</span>
									{/if}
									<div class="min-w-0">
										<a href="/admin/tenants/{row.tenantId}" class="font-medium text-brand-600 hover:underline">{row.name}</a>
										{#if row.isVerified}
											<span class="badge ml-1.5 bg-success/10 text-success">Verified</span>
										{/if}
										<div class="truncate font-mono text-[11.5px] text-slate-400">
											{row.tenantSlug} · joined <TimeAgo value={row.createdAt} />
										</div>
									</div>
								</div>
							</td>

							<td class="table-cell"><StatusBadge value={row.accountStatus} /></td>

							<td class="table-cell">
								{#if row.listings === 0}
									<span class="text-slate-400">none yet</span>
								{:else}
									<a href="/admin/marketplace/tours?q={encodeURIComponent(row.name)}" class="hover:underline">
										<!-- Published is the number with consequences, so it is the one that
										     gets colour when there is no badge behind it. -->
										<span class={row.published > 0 && !row.isVerified ? 'font-semibold text-warning' : 'font-medium text-slate-700'}>
											{row.published} live
										</span>
										<span class="text-slate-400"> · {row.pending} pending</span>
									</a>
								{/if}
							</td>

							<td class="table-cell">
								{#if !row.profileId}
									<span class="badge bg-danger/10 text-danger">No public profile</span>
								{:else}
									<span class="text-slate-600 tabular-nums">{row.completeness}/{row.completenessTotal}</span>
									{#if row.missingProfileFields.length}
										<div class="text-[11.5px] text-slate-400">missing {row.missingProfileFields.join(', ')}</div>
									{/if}
								{/if}
							</td>

							<td class="table-cell">
								<div class="text-slate-600">{row.ownerEmail ?? '—'}</div>
								{#if row.ownerEmail}
									<div class="text-[11.5px] {row.ownerEmailConfirmed ? 'text-slate-400' : 'text-warning'}">
										{row.ownerEmailConfirmed ? 'confirmed' : 'not confirmed'}
									</div>
								{/if}
							</td>

							<td class="table-cell text-right">
								{#if !row.profileId}
									<!-- Nothing to verify, and saying why beats a disabled button: the
									     profile appears on its own once they publish or open storefront
									     settings, so this is a wait, not a fix. -->
									<span class="text-[11.5px] text-slate-400">nothing to verify yet</span>
								{:else if row.isVerified}
									{#if withdrawing === row.tenantId}
										<form method="POST" action="?/verify" use:enhance={() => async ({ update }) => { await update(); withdrawing = null; }} class="inline-flex items-center gap-1.5">
											<input type="hidden" name="tenantId" value={row.tenantId} />
											<input type="hidden" name="verified" value="false" />
											<span class="text-[11.5px] text-slate-500">Remove the badge?</span>
											<button class="btn-secondary !py-1 text-[11.5px] !text-danger">Withdraw</button>
											<button type="button" class="text-[11.5px] text-slate-500 hover:underline" onclick={() => (withdrawing = null)}>Cancel</button>
										</form>
									{:else}
										<button type="button" class="text-xs font-medium text-slate-500 hover:underline" onclick={() => (withdrawing = row.tenantId)}>Withdraw</button>
									{/if}
								{:else}
									<form method="POST" action="?/verify" use:enhance class="inline">
										<input type="hidden" name="tenantId" value={row.tenantId} />
										<input type="hidden" name="verified" value="true" />
										<button class="btn-secondary !py-1 text-[11.5px]">Verify operator</button>
									</form>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6">
								{#if data.tab === 'awaiting'}
									<EmptyState
										title="Nobody is waiting"
										description="Every operator with a public profile has been checked. New ones appear here the moment they get a storefront, which happens when they publish their first listing."
									/>
								{:else if data.tab === 'missing'}
									<EmptyState
										title="Every operator with listings has a profile"
										description="This view catches listings with no company behind them — the empty card a traveller would otherwise land on. It should stay at zero."
									/>
								{:else}
									<EmptyState title="No verified operators yet" description="Operators you verify appear here, with the badge showing on their public storefront." />
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
