<script lang="ts">
	// Plan definitions. Operational, not a billing product editor: name, price, active,
	// and the entitlement values every tenant on the plan inherits.
	import { enhance } from '$lib/forms';
	import FormToast from '$components/FormToast.svelte';
	let { data, form } = $props();
	let editing = $state<string | null>(null);

	const groupsFor = () => {
		const map = new Map<string, typeof data.entitlements>();
		for (const e of data.entitlements) {
			if (!map.has(e.group)) map.set(e.group, []);
			map.get(e.group)!.push(e);
		}
		return [...map.entries()];
	};
	const groups = groupsFor();
	const valueOf = (plan: (typeof data.plans)[number], key: string) => (plan.entitlements as Record<string, boolean | number>)?.[key];
</script>

<svelte:head><title>Plans · Makutano Admin</title></svelte:head>

<FormToast {form} successTitle="Plan saved" />

<div class="space-y-3">
	<div>
		<h1 class="text-base font-semibold text-slate-800">Plans</h1>
		<p class="text-xs text-slate-400">Entitlements every tenant on the plan inherits. A tenant can be given individual overrides in its Control Center.</p>
	</div>

	{#each data.plans as plan (plan.id)}
		<section class="card">
			<header class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
				<div class="flex items-center gap-2">
					<h2 class="text-sm font-semibold text-slate-700">{plan.name}</h2>
					<span class="badge bg-slate-100 font-mono text-[11.5px] text-slate-500">{plan.code}</span>
					<span class="badge {plan.isActive ? 'bg-success/10 text-success' : 'bg-slate-100 text-slate-400'} text-xs">{plan.isActive ? 'active' : 'inactive'}</span>
					<span class="text-[12.5px] font-semibold text-slate-600">{plan.currency} {Number(plan.priceMonthly).toLocaleString()} / mo</span>
					<span class="text-[12.5px] text-slate-400">{data.tenantsByPlan[plan.id] ?? 0} tenant(s)</span>
				</div>
				<button class="btn-secondary !py-1 text-xs" onclick={() => (editing = editing === plan.id ? null : plan.id)}>
					{editing === plan.id ? 'Close' : 'Edit plan'}
				</button>
			</header>

			{#if editing === plan.id}
				<form method="POST" action="?/save" use:enhance={() => async ({ update }) => { await update(); editing = null; }} class="space-y-4 border-t border-slate-100 bg-slate-50/60 p-4">
					<input type="hidden" name="planId" value={plan.id} />
					<div class="grid gap-3 sm:grid-cols-4">
						<div><label class="label" for="n-{plan.id}">Name</label><input id="n-{plan.id}" name="name" value={plan.name} class="input" /></div>
						<div><label class="label" for="p-{plan.id}">Price / month</label><input id="p-{plan.id}" name="priceMonthly" inputmode="decimal" value={plan.priceMonthly} class="input" /></div>
						<div><label class="label" for="c-{plan.id}">Currency</label><input id="c-{plan.id}" name="currency" maxlength="3" value={plan.currency} placeholder="USD" class="input font-mono uppercase" /></div>
						<label class="flex items-end gap-2 pb-2 text-sm text-slate-600">
							<input type="checkbox" name="isActive" checked={plan.isActive} class="rounded border-slate-300" /> Active
						</label>
					</div>

					{#each groups as [group, items] (group)}
						<div>
							<p class="pb-1.5 text-[11.5px] font-bold uppercase tracking-widest text-slate-400">{group}</p>
							<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{#each items as e (e.key)}
									<div class="flex items-center justify-between gap-2 rounded-panel border border-slate-200 bg-white px-2.5 py-1.5">
										<div class="min-w-0">
											<div class="truncate text-xs font-medium text-slate-600">{e.label}</div>
											<div class="truncate font-mono text-[11.5px] text-slate-400">{e.key}</div>
										</div>
										{#if e.kind === 'boolean'}
											<input type="checkbox" name="e_{e.key}" checked={valueOf(plan, e.key) === true} class="shrink-0 rounded border-slate-300" />
										{:else}
											<input type="number" min="0" name="e_{e.key}" value={String(valueOf(plan, e.key) ?? 0)} title="0 = unlimited" class="input w-24 shrink-0 py-1 text-xs" />
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/each}

					<div class="flex items-center gap-3">
						<button class="btn-primary">Save plan</button>
						<span class="text-[12.5px] text-slate-400">0 means unlimited. Changes apply immediately to every tenant on this plan.</span>
					</div>
				</form>
			{/if}
		</section>
	{/each}
</div>
