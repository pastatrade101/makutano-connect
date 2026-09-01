<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();

	const canRespond = $derived(data.permissions?.includes('reviews:respond' as never) ?? false);
	/** Which review's reply box is open. One at a time; this is not a bulk tool. */
	let replying = $state<string | null>(null);

	const TABS = [
		{ key: 'all', label: 'All' },
		{ key: 'published', label: 'Published' },
		{ key: 'awaiting', label: 'Awaiting your response' }
	];
	const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
</script>

<FormToast {form} successTitle="Response published" />

<svelte:head><title>Reviews · {data.tenant.name}</title></svelte:head>

<div class="space-y-3">
	<div>
		<h1 class="text-xl font-bold tracking-tight text-slate-900 sm:text-base sm:font-semibold">Reviews</h1>
		<p class="mt-0.5 text-[12.5px] text-slate-500">
			Written by travellers who booked with you. You can reply; only Makutano publishes or removes.
		</p>
	</div>

	<div class="flex flex-wrap gap-1.5">
		{#each TABS as tab (tab.key)}
			<a
				href="/app/reviews{tab.key === 'all' ? '' : `?tab=${tab.key}`}"
				class="min-h-9 rounded-panel border px-3 py-1.5 text-xs font-semibold {data.tab === tab.key
					? 'border-brand-600 bg-brand-600 text-white'
					: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
			>
				{tab.label}
			</a>
		{/each}
	</div>

	{#if data.items.length === 0}
		<div class="card">
			<EmptyState
				title="No reviews yet"
				description="After a trip finishes, open the booking and choose “Ask for a review”. The traveller gets a private link."
			/>
		</div>
	{:else}
		<div class="space-y-2">
			{#each data.items as review (review.id)}
				<article class="card p-4">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="text-base text-amber-500" aria-label="{review.rating} out of 5">{stars(review.rating)}</p>
							{#if review.title}<h2 class="mt-1 font-semibold text-slate-900">{review.title}</h2>{/if}
							<p class="text-[12.5px] text-slate-500">
								{[review.firstName, review.lastName].filter(Boolean).join(' ') || 'A traveller'}
								{#if review.tourTitle} · {review.tourTitle}{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<StatusBadge value={review.status} />
							<span class="text-[12px] text-slate-400">
								<TimeAgo value={review.submittedAt} timezone={data.tenant.timezone} />
							</span>
						</div>
					</div>

					<p class="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{review.body}</p>
					<p class="mt-2 text-[11.5px] text-slate-400">Booking {review.bookingReference}</p>

					{#if review.operatorResponse}
						<div class="mt-3 rounded-panel border-l-2 border-brand-500 bg-slate-50 px-3 py-2.5">
							<p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Your response</p>
							<p class="mt-1 text-[13px] whitespace-pre-wrap text-slate-600">{review.operatorResponse}</p>
						</div>
					{/if}

					<!-- Replying needs a published review: answering something the public
					     cannot see is a conversation with nobody. -->
					{#if canRespond && review.status === 'PUBLISHED'}
						{#if replying === review.id}
							<form method="POST" action="?/respond" use:enhance class="mt-3 space-y-2">
								<input type="hidden" name="reviewId" value={review.id} />
								<textarea
									name="response"
									rows="3"
									maxlength="2000"
									required
									class="input"
									placeholder="Thank you for travelling with us…">{review.operatorResponse ?? ''}</textarea>
								<div class="flex gap-2">
									<button class="btn-primary !py-1.5 text-xs">
										{review.operatorResponse ? 'Update response' : 'Publish response'}
									</button>
									<button type="button" class="btn-secondary !py-1.5 text-xs" onclick={() => (replying = null)}>
										Cancel
									</button>
								</div>
							</form>
						{:else}
							<button class="btn-secondary mt-3 !py-1.5 text-xs" onclick={() => (replying = review.id)}>
								{review.operatorResponse ? 'Edit response' : 'Respond'}
							</button>
						{/if}
					{/if}
				</article>
			{/each}
		</div>

		<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
	{/if}
</div>
