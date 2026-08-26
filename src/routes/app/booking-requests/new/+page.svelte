<script lang="ts">
	import { enhance } from '$lib/forms';
	import WorkspaceNotice from '$components/WorkspaceNotice.svelte';
	let { data, form } = $props();

	// Simple first: who, how to reach them, what they want. Everything else lives
	// behind "More details" — a phone enquiry should take fifteen seconds to log.
	let more = $state(false);
	const noun = $derived(data.workspace === 'BOOKINGS' ? 'traveller' : 'customer');
</script>

<svelte:head><title>New enquiry · {data.tenant.name}</title></svelte:head>

{#if !data.workspaceRelevant}
	<WorkspaceNotice module="Enquiries" />
{:else}
	<div class="mx-auto max-w-2xl space-y-3">
		<div>
			<a href="/app/booking-requests" class="text-xs text-slate-500 hover:underline">← Enquiries</a>
			<h1 class="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-lg">New enquiry</h1>
			<p class="mt-1 text-[13px] text-slate-500">
				For enquiries that arrive by phone, in person, or anywhere Connect cannot see. Website and
				WhatsApp enquiries arrive on their own.
			</p>
		</div>

		<form method="POST" use:enhance class="card space-y-4 p-4 sm:p-5">
			{#if form?.message}
				<p class="rounded-lg border border-danger/15 bg-danger/5 px-3 py-2.5 text-xs text-danger" role="alert">{form.message}</p>
			{/if}

			<div>
				<label class="label" for="e-name">Who is it from?</label>
				<input id="e-name" name="name" required value={form?.name ?? data.conversation?.name ?? ''} placeholder="Amina Said" class="input" />
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="label" for="e-phone">WhatsApp number</label>
					<input id="e-phone" name="phone" value={form?.phone ?? data.conversation?.phone ?? ''} placeholder="+255 712 345 678" class="input" />
				</div>
				<div>
					<label class="label" for="e-email">Email <span class="font-normal text-slate-400">(optional)</span></label>
					<input id="e-email" name="email" type="email" value={form?.email ?? ''} placeholder="amina@example.com" class="input" />
				</div>
			</div>

			<div>
				<label class="label" for="e-notes">What are they asking for?</label>
				<textarea id="e-notes" name="notes" rows="3" class="input" placeholder="4 days Serengeti and Ngorongoro, mid-range lodges, family of five.">{form?.notes ?? ''}</textarea>
			</div>

			<button type="button" class="text-[13px] font-medium text-brand-600 hover:underline" onclick={() => (more = !more)}>
				{more ? 'Fewer details' : 'More details'} {more ? '▴' : '▾'}
			</button>

			{#if more}
				<div class="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
					<div><label class="label" for="e-start">From</label><input id="e-start" name="startDate" type="date" value={form?.startDate ?? ''} class="input" /></div>
					<div><label class="label" for="e-end">To</label><input id="e-end" name="endDate" type="date" value={form?.endDate ?? ''} class="input" /></div>
					<div><label class="label" for="e-adults">Adults</label><input id="e-adults" name="adults" type="number" min="0" value={form?.adults ?? ''} class="input" /></div>
					<div><label class="label" for="e-children">Children</label><input id="e-children" name="children" type="number" min="0" value={form?.children ?? ''} class="input" /></div>
					<div class="sm:col-span-2">
						<label class="label" for="e-budget">Budget they mentioned <span class="font-normal text-slate-400">(optional)</span></label>
						<input id="e-budget" name="estimatedTotal" inputmode="decimal" value={form?.estimatedTotal ?? ''} placeholder="2000" class="input" />
						<p class="mt-1 text-[11.5px] text-slate-400">What the {noun} said they expect to spend — never a quoted price.</p>
					</div>
				</div>
			{/if}

			<label class="flex items-start gap-2.5 rounded-lg bg-slate-50/70 p-3 text-[13px] text-slate-600">
				<input type="checkbox" name="acknowledge" class="mt-0.5 size-4 rounded border-slate-300" />
				<span>Send them a WhatsApp acknowledgement now</span>
			</label>

			<div class="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
				<a href="/app/booking-requests" class="btn-secondary">Cancel</a>
				<button class="btn-primary !px-5">Create enquiry</button>
			</div>
		</form>
	</div>
{/if}
