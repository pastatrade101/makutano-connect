<script lang="ts">
	import { enhance } from '$lib/forms';
	import Money from '$components/Money.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import ReadinessRing from '$components/ReadinessRing.svelte';
	import { blockerLabel, plural } from '$lib/labels';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();

	// One workspace, four views — not four screens. Operations staff work a trip in
	// passes (set it up, check the guests, walk the days), and making each pass a
	// separate page would mean losing the readiness number every time they move.
	let tab = $state<'overview' | 'itinerary' | 'guests' | 'setup'>('setup');

	// Which set-up row is open for editing. Only one at a time: this is a phone-first
	// pattern lifted onto the desktop, and it keeps every row a single decision.
	let editing = $state<string | null>(null);
	// What the open row's picker is showing. FREE is the escape hatch: a driver
	// who is not registered yet must not block a departure on bookkeeping nobody
	// has done, so every picker can fall back to a typed name.
	const FREE = '__free__';
	let pick = $state<string>('');
	function openRow(key: string, selected: string | null | undefined) {
		editing = key;
		pick = selected ?? '';
	}

	const guests = $derived(data.trip.adults + data.trip.children);
	const days = $derived(
		[...new Set(data.items.map((i) => i.dayNumber).filter((d): d is number => d != null))].sort((a, b) => a - b)
	);
	const undated = $derived(data.items.filter((i) => i.dayNumber == null));

	const fmt = (v: string | Date | null) =>
		v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

	const daysOut = $derived.by(() => {
		if (!data.trip.startDate) return null;
		const d = new Date(data.trip.startDate);
		const day = 86_400_000;
		const now = new Date();
		return Math.round(
			(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
				Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) /
				day
		);
	});

	/**
	 * The set-up rows. Each is one field, one sheet, one decision.
	 *
	 * `critical` mirrors the server's readiness CHECKS: a row the trip cannot leave
	 * without reads differently from one that is merely nice to have, so nobody
	 * hunts through four identical "Missing" labels to find the blocking one.
	 */
	/** Which rows pick from a list, and what that list is. */
	const options = $derived({
		accommodation: { field: 'accommodationItemId', list: data.accommodations, selected: data.trip.accommodationItemId },
		driver: { field: 'driverCrewId', list: data.crew.drivers, selected: data.trip.driverCrewId },
		guide: { field: 'guideCrewId', list: data.crew.guides, selected: data.trip.guideCrewId },
		specialist: { field: 'specialistCrewId', list: data.crew.specialists, selected: data.trip.specialistCrewId }
	} as Record<string, { field: string; list: Array<{ id: string; name: string }>; selected: string | null } | undefined>);

	const rows = $derived([
		{ key: 'accommodation', label: 'Accommodation', icon: 'M3 9l7-5 7 5v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z', value: data.trip.accommodation, placeholder: 'Which lodge or hotel', critical: true },
		{ key: 'vehicle', label: 'Vehicle', icon: 'M3 12h14M5 12V8l2-3h6l2 3v4M6 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', value: data.trip.vehicle, placeholder: 'e.g. T 123 ABC — Land Cruiser', critical: true },
		{ key: 'driver', label: 'Driver', icon: 'M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 6a6 6 0 0 1 12 0', value: data.trip.driver, placeholder: 'Who is driving', critical: true },
		{ key: 'guide', label: 'Guide', icon: 'M10 3 3 6.5v4c0 3.6 2.9 6 7 6.5 4.1-.5 7-2.9 7-6.5v-4L10 3Z', value: data.trip.guide, placeholder: 'Who is guiding', critical: false },
		// Deliberately NOT a readiness check: most game drives never need one, and
		// a permanently unticked "Specialist assigned" would train people to ignore
		// the list. It is a seat you fill when the trip calls for it.
		{ key: 'specialist', label: 'Specialist', icon: 'M10 2.5 12 7l4.5.5-3.4 3.1.9 4.6L10 13l-4 2.2.9-4.6L3.5 7.5 8 7l2-4.5Z', value: data.trip.specialist, placeholder: 'Mountain guide, birding expert…', critical: false }
	]);
</script>

<svelte:head><title>{data.trip.title} · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<a href="/app/trips" class="text-xs text-slate-400 hover:underline">← Trips</a>
			<h1 class="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-lg">{data.trip.title}</h1>
			<p class="text-xs text-slate-400">
				{data.trip.tripReference} · from
				<a href="/app/bookings/{data.booking.id}" class="text-brand-600 hover:underline">{data.booking.bookingReference}</a>
			</p>
		</div>
		<div class="flex items-center gap-3">
			<StatusBadge value={data.trip.status} />
			<ReadinessRing readiness={data.readiness} status={data.trip.status} daysToDeparture={daysOut} size={56} />
		</div>
	</div>

	{#if form?.error}
		<div class="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{form.error}</div>
	{/if}

	<!-- The one action that matters, decided by the readiness model rather than by
	     which button someone felt like showing. -->
	{#if data.canWrite && !['COMPLETED', 'CANCELLED'].includes(data.trip.status)}
		<div class="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
			<div class="min-w-0">
				{#if data.readiness.canBeReady && data.trip.status === 'PREPARING'}
					<p class="text-sm font-semibold text-slate-900">Everything critical is in place.</p>
					<p class="text-xs text-slate-500">Mark it ready so the rest of the team knows it can leave.</p>
				{:else if data.trip.status === 'PREPARING'}
					<p class="text-sm font-semibold text-slate-900">
						{plural(data.readiness.missing.filter((c) => c.critical).length, 'thing')} still stopping this trip leaving
					</p>
					<p class="text-xs text-slate-500">
						Still needs {data.readiness.missing.filter((c) => c.critical).map(blockerLabel).join(', ')}
					</p>
				{:else if data.trip.status === 'READY'}
					<p class="text-sm font-semibold text-slate-900">Ready to go.</p>
					<p class="text-xs text-slate-500">Start it when the travellers are on their way.</p>
				{:else}
					<p class="text-sm font-semibold text-slate-900">Trip under way.</p>
					<p class="text-xs text-slate-500">Complete it when they are home.</p>
				{/if}
			</div>
			<form method="POST" action="?/status" use:enhance class="flex items-center gap-2">
				{#if data.trip.status === 'PREPARING'}
					<button
						name="status"
						value="READY"
						class="btn-primary"
						disabled={!data.readiness.canBeReady}
						title={data.readiness.canBeReady ? '' : 'Some critical set-up is still missing'}>Mark ready</button>
				{:else if data.trip.status === 'READY'}
					<button name="status" value="PREPARING" class="btn-ghost">Back to preparing</button>
					<button name="status" value="IN_PROGRESS" class="btn-primary">Start trip</button>
				{:else if data.trip.status === 'IN_PROGRESS'}
					<button name="status" value="COMPLETED" class="btn-primary">Complete trip</button>
				{/if}
			</form>
		</div>
	{/if}

	<div class="card overflow-hidden">
		<div class="flex gap-1 border-b border-slate-100 px-3 py-2">
			{#each [['setup', 'Setup'], ['overview', 'Overview'], ['itinerary', 'Itinerary'], ['guests', `Guests (${guests})`]] as [key, label]}
				<button
					type="button"
					onclick={() => (tab = key as typeof tab)}
					class="rounded-lg px-3 py-1.5 text-sm font-medium {tab === key
						? 'bg-brand-50 text-brand-700'
						: 'text-slate-500 hover:bg-slate-50'}">{label}</button>
			{/each}
		</div>

		{#if tab === 'setup'}
			<!-- Everything that has to be true before this trip can leave, in one list,
			     so nobody has to visit four modules to find out what is missing. -->
			<ul class="divide-y divide-slate-100">
				{#each rows as row (row.key)}
					<li class="px-4 py-3">
						{#if editing === row.key && data.canWrite}
							{@const picker = options[row.key]}
							<form
								method="POST"
								action="?/update"
								use:enhance={() => async ({ update }) => {
									await update({ reset: false });
									editing = null;
								}}
								class="flex flex-wrap items-center gap-2">
								<label class="w-32 shrink-0 text-sm text-slate-500" for="f-{row.key}">{row.label}</label>
								{#if picker && picker.list.length}
									<!-- Pick from the tenant's own list, or type a name. Choosing
									     "Someone else" drops the select's NAME so only the free text
									     posts — the server treats a typed name as explicitly not the
									     registered person and clears the link. -->
									<select
										id="f-{row.key}"
										name={pick === FREE ? undefined : picker.field}
										bind:value={pick}
										class="input min-w-0 flex-1">
										<option value="">Nobody yet</option>
										{#each picker.list as option (option.id)}
											<option value={option.id}>{option.name}</option>
										{/each}
										<option value={FREE}>Someone else…</option>
									</select>
									{#if pick === FREE}
										<input
											name={row.key}
											value={row.value ?? ''}
											placeholder={row.placeholder}
											class="input min-w-0 flex-1"
											required />
									{/if}
								{:else}
									<input
										id="f-{row.key}"
										name={row.key}
										value={row.value ?? ''}
										placeholder={row.placeholder}
										class="input min-w-0 flex-1" />
								{/if}
								<button class="btn-primary">Save</button>
								<button type="button" class="btn-ghost" onclick={() => (editing = null)}>Cancel</button>
							</form>
							{#if picker && picker.list.length}
								<p class="mt-1.5 pl-32 text-xs text-slate-400">
									Not on the list? Add them under
									<a href={row.key === 'accommodation' ? '/app/catalog' : '/app/crew'} class="text-brand-600 hover:underline"
										>{row.key === 'accommodation' ? 'Catalog' : 'Crew'}</a
									>.
								</p>
							{/if}
						{:else}
							<div class="flex items-center gap-3">
								<span
									class="grid size-8 shrink-0 place-items-center rounded-lg {row.value
										? 'bg-success/10 text-success'
										: row.critical
											? 'bg-danger/10 text-danger'
											: 'bg-slate-100 text-slate-400'}"
								>
									<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" class="size-4">
										<path d={row.icon} stroke-linecap="round" stroke-linejoin="round" />
									</svg>
								</span>
								<div class="min-w-0 flex-1">
									<div class="text-xs text-slate-500">{row.label}</div>
									<div class="truncate text-sm {row.value ? 'font-medium text-slate-900' : 'text-slate-400'}">
										{row.value ?? (row.critical ? 'Required before departure' : 'Not set')}
									</div>
								</div>
								{#if data.canWrite}
									<button type="button" class="btn-ghost shrink-0" onclick={() => openRow(row.key, options[row.key]?.selected)}>
										{row.value ? 'Change' : 'Set'}
									</button>
								{/if}
							</div>
						{/if}
					</li>
				{/each}

				<li class="flex items-center gap-3 px-4 py-3">
					<span
						class="grid size-8 shrink-0 place-items-center rounded-lg {data.trip.hotelConfirmed
							? 'bg-success/10 text-success'
							: 'bg-slate-100 text-slate-400'}"
					>
						<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" class="size-4">
							<path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="text-xs text-slate-500">Hotel confirmed</div>
						<div class="truncate text-sm {data.trip.hotelConfirmed ? 'font-medium text-slate-900' : 'text-slate-400'}">
							{data.trip.hotelConfirmed ? 'Confirmed with the property' : 'Not confirmed yet'}
						</div>
					</div>
					{#if data.canWrite}
						<form method="POST" action="?/update" use:enhance class="shrink-0">
							{#if data.trip.hotelConfirmed}
								<input type="hidden" name="hotelConfirmed" value="off" />
								<button class="btn-ghost">Undo</button>
							{:else}
								<input type="hidden" name="hotelConfirmed" value="on" />
								<button class="btn-ghost">Mark confirmed</button>
							{/if}
						</form>
					{/if}
				</li>

				<li class="flex items-center gap-3 px-4 py-3">
					<span
						class="grid size-8 shrink-0 place-items-center rounded-lg {data.trip.operationsUserId
							? 'bg-brand-50 text-brand-600'
							: 'bg-slate-100 text-slate-400'}"
					>
						<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" class="size-4">
							<path
								d="M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm-5 7a5 5 0 0 1 10 0M13 5.5a2 2 0 1 1 0 4M14 16a4.5 4.5 0 0 0-1.2-3"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</span>
					<div class="min-w-0 flex-1">
						<div class="text-xs text-slate-500">Operations owner</div>
						{#if data.canAssign}
							<form method="POST" action="?/update" use:enhance class="mt-1 flex items-center gap-2">
								<select name="operationsUserId" class="input min-w-0 flex-1 py-1 text-sm">
									<option value="" selected={!data.trip.operationsUserId}>Nobody yet</option>
									{#each data.members as m (m.id)}
										<option value={m.id} selected={data.trip.operationsUserId === m.id}>{m.name} · {m.role}</option>
									{/each}
								</select>
								<button class="btn-ghost shrink-0">Assign</button>
							</form>
						{:else}
							<div class="truncate text-sm {data.trip.operationsUserId ? 'font-medium text-slate-900' : 'text-slate-400'}">
								{data.members.find((m) => m.id === data.trip.operationsUserId)?.name ?? 'Nobody yet'}
							</div>
						{/if}
					</div>
				</li>

				<!-- Money is shown, never edited. Operations needs to know a balance is
				     outstanding before a departure; changing it is the booking's job. -->
				<li class="flex items-center gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
					<span class="w-32 shrink-0 text-xs uppercase tracking-wide text-slate-400">Payment</span>
					<span class="min-w-0 flex-1 text-sm">
						{#if Number(data.booking.balanceDue) > 0}
							<span class="font-medium text-danger">
								<Money amount={data.booking.balanceDue} currency={data.booking.currency} /> outstanding
							</span>
						{:else}
							<span class="text-success">Paid in full</span>
						{/if}
					</span>
					<a href="/app/bookings/{data.booking.id}" class="btn-ghost">Open booking</a>
				</li>
			</ul>
		{:else if tab === 'overview'}
			<dl class="divide-y divide-slate-100">
				{#each [['Customer', [data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || '—'], ['Dates', `${fmt(data.trip.startDate)} → ${fmt(data.trip.endDate)}`], ['Guests', `${data.trip.adults} adult(s), ${data.trip.children} child(ren)`], ['Booking', data.booking.bookingReference], ['Booking status', data.booking.status.replace(/_/g, ' ')]] as [label, value]}
					<div class="flex gap-3 px-4 py-3">
						<dt class="w-32 shrink-0 text-sm text-slate-500">{label}</dt>
						<dd class="text-sm text-slate-900">{value}</dd>
					</div>
				{/each}
			</dl>
			<div class="border-t border-slate-100 px-4 py-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Readiness</h3>
				<ul class="mt-2 space-y-1">
					{#each data.readiness.checks as c (c.key)}
						<li class="flex items-center gap-2 text-sm">
							<span class={c.done ? 'text-success' : c.critical ? 'text-danger' : 'text-slate-300'}>
								{c.done ? '✓' : '✕'}
							</span>
							<span class={c.done ? 'text-slate-500' : 'text-slate-900'}>{c.label}</span>
							{#if !c.done && c.critical}<span class="text-xs font-medium text-danger">blocking</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
			<div class="border-t border-slate-100 px-4 py-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">History</h3>
				<ul class="mt-2 space-y-1">
					{#each data.history as h (h.id)}
						<li class="text-sm text-slate-600">
							{h.fromStatus ? `${h.fromStatus} → ` : ''}{h.toStatus}
							{#if h.reason}<span class="text-slate-400">· {h.reason}</span>{/if}
							<span class="text-slate-400">· <TimeAgo value={h.createdAt} timezone={data.tenant.timezone} /></span>
						</li>
					{/each}
				</ul>
			</div>
		{:else if tab === 'itinerary'}
			{#if data.items.length === 0}
				<p class="px-4 py-8 text-center text-sm text-slate-500">Nothing was copied across from the booking.</p>
			{:else}
				<div class="divide-y divide-slate-100">
					{#each days as day (day)}
						<div class="px-4 py-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Day {day}</h3>
							<ul class="mt-1.5 space-y-1.5">
								{#each data.items.filter((i) => i.dayNumber === day) as item (item.id)}
									<li class="text-sm">
										<span class="font-medium text-slate-900">{item.title}</span>
										<span class="ml-2 text-xs uppercase text-slate-400">{item.type}</span>
										{#if item.description}<p class="text-xs text-slate-500">{item.description}</p>{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/each}
					{#if undated.length}
						<div class="px-4 py-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-400">Not scheduled to a day</h3>
							<ul class="mt-1.5 space-y-1.5">
								{#each undated as item (item.id)}
									<li class="text-sm">
										<span class="font-medium text-slate-900">{item.title}</span>
										<span class="ml-2 text-xs uppercase text-slate-400">{item.type}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
			{#if data.travelers.length === 0}
				<p class="px-4 py-8 text-center text-sm text-slate-500">
					No traveller details captured yet — they are added on the booking.
				</p>
			{:else}
				<table class="min-w-full divide-y divide-slate-100">
					<thead class="bg-slate-50">
						<tr>
							<th class="table-head">Name</th><th class="table-head">Nationality</th>
							<th class="table-head">Passport</th><th class="table-head">Dietary</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.travelers as t (t.id)}
							<tr>
								<td class="table-cell font-medium">{[t.firstName, t.lastName].filter(Boolean).join(' ')}</td>
								<td class="table-cell">{t.nationality ?? '—'}</td>
								<td class="table-cell">
									{#if !data.canSeeSensitive}
										<span class="text-xs text-slate-400">Hidden</span>
									{:else if t.passportNumber}
										{t.passportNumber}
									{:else}
										<span class="text-xs font-medium text-danger">Missing</span>
									{/if}
								</td>
								<td class="table-cell text-slate-500">{t.dietaryRequirements ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{/if}
	</div>
</div>
