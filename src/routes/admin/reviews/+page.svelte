<script lang="ts">
	import FormToast from '$components/FormToast.svelte';
	import EmptyState from '$components/EmptyState.svelte';
	import Pagination from '$components/Pagination.svelte';
	import StatusBadge from '$components/StatusBadge.svelte';
	import TimeAgo from '$components/TimeAgo.svelte';
	import { enhance } from '$lib/forms';
	let { data, form } = $props();

	/** Which review is being taken down. Hiding and rejecting need a reason. */
	let removing = $state<string | null>(null);
	const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
	const LABEL: Record<string, string> = {
		PENDING: 'Pending',
		PUBLISHED: 'Published',
		HIDDEN: 'Hidden',
		REJECTED: 'Rejected'
	};
</script>

<FormToast {form} successTitle="Review updated" />

<svelte:head><title>Review moderation · Makutano</title></svelte:head>

<div class="space-y-3">
	<div>
		<h1 class="text-base font-semibold text-slate-900">Review moderation</h1>
		<p class="mt-0.5 text-[12.5px] text-slate-500">
			Every review here is backed by a real booking. Operators can reply; only this screen decides
			what the public sees.
		</p>
	</div>

	<div class="flex flex-wrap gap-1.5">
		{#each data.statuses as status (status)}
			<a
				href="/admin/reviews?status={status}"
				class="min-h-9 rounded-panel border px-3 py-1.5 text-xs font-semibold {data.status === status
					? 'border-brand-600 bg-brand-600 text-white'
					: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
			>
				{LABEL[status]}
			</a>
		{/each}
	</div>

	{#if data.items.length === 0}
		<div class="card">
			<EmptyState title="Nothing {LABEL[data.status].toLowerCase()}" description="No reviews in this state." />
		</div>
	{:else}
		<div class="space-y-2">
			{#each data.items as review (review.id)}
				<article class="card p-4">
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="text-base text-amber-500" aria-label="{review.rating} out of 5">{stars(review.rating)}</p>
							{#if review.title}<h2 class="mt-1 font-semibold text-slate-900">{review.title}</h2>{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<StatusBadge value={review.status} />
							<span class="text-[12px] text-slate-400">
								<TimeAgo value={review.submittedAt} timezone="UTC" />
							</span>
						</div>
					</div>

					<p class="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{review.body}</p>

					<!-- Enough context to judge authenticity, and no more. This is an
					     internal screen, so the booking reference belongs here — it is
					     the thing that proves the trip happened. -->
					<dl class="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
						<div class="flex gap-2">
							<dt class="text-slate-400">Traveller</dt>
							<dd class="text-slate-700">
								{[review.customerFirst, review.customerLast].filter(Boolean).join(' ') || 'Unknown'}
							</dd>
						</div>
						<div class="flex gap-2">
							<dt class="text-slate-400">Operator</dt>
							<dd class="text-slate-700">{review.operatorName ?? review.tenantName}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="text-slate-400">Trip</dt>
							<dd class="text-slate-700">{review.tourTitle ?? 'Custom trip'}</dd>
						</div>
						<div class="flex gap-2">
							<dt class="text-slate-400">Booking</dt>
							<dd class="font-mono text-slate-700">{review.bookingReference}</dd>
						</div>
					</dl>

					{#if review.editedAt}
						<p class="mt-2 text-[12px] text-amber-700">Edited by the traveller after submission.</p>
					{/if}
					{#if review.moderationReason}
						<p class="mt-2 text-[12px] text-slate-500">Reason on file: {review.moderationReason}</p>
					{/if}
					{#if review.operatorResponse}
						<div class="mt-3 rounded-panel border-l-2 border-slate-300 bg-slate-50 px-3 py-2.5">
							<p class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Operator response</p>
							<p class="mt-1 text-[13px] whitespace-pre-wrap text-slate-600">{review.operatorResponse}</p>
						</div>
					{/if}

					<div class="mt-3 flex flex-wrap gap-1.5">
						{#if review.status !== 'PUBLISHED'}
							<form method="POST" action="?/moderate" use:enhance>
								<input type="hidden" name="reviewId" value={review.id} />
								<input type="hidden" name="action" value={review.status === 'HIDDEN' ? 'restore' : 'publish'} />
								<button class="btn-primary !py-1.5 text-xs">
									{review.status === 'HIDDEN' ? 'Restore' : 'Publish'}
								</button>
							</form>
						{/if}
						{#if review.status !== 'HIDDEN' && review.status !== 'REJECTED'}
							<button class="btn-secondary !py-1.5 text-xs" onclick={() => (removing = removing === review.id ? null : review.id)}>
								Hide or reject
							</button>
						{/if}
					</div>

					<!-- A reason is required by the service, not merely asked for here:
					     a review taken down without one cannot be revisited later. -->
					{#if removing === review.id}
						<form method="POST" action="?/moderate" use:enhance class="mt-2 flex flex-wrap items-end gap-2">
							<input type="hidden" name="reviewId" value={review.id} />
							<div>
								<label class="label" for="reason-{review.id}">Reason</label>
								<select id="reason-{review.id}" name="reason" required class="input w-auto !py-1.5 text-xs">
									{#each data.reasons as reason (reason)}<option value={reason}>{reason}</option>{/each}
								</select>
							</div>
							<button name="action" value="hide" class="btn-secondary !py-1.5 text-xs">Hide</button>
							<button name="action" value="reject" class="btn-secondary !py-1.5 text-xs text-danger">Reject</button>
						</form>
					{/if}
				</article>
			{/each}
		</div>

		<Pagination total={data.total} pageNumber={data.pagination.page} limit={data.pagination.limit} />
	{/if}
</div>
