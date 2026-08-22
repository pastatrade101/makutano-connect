<script lang="ts">
	import { enhance } from '$app/forms';
	import TimeAgo from '$components/TimeAgo.svelte';
	let { data, form } = $props();
	const canSend = $derived(data.permissions?.includes('whatsapp:send'));
	const who = $derived([data.customer?.firstName, data.customer?.lastName].filter(Boolean).join(' ') || `+${data.conversation.externalId ?? ''}`);
</script>

<svelte:head><title>{who} · Inbox</title></svelte:head>

<div class="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
	<header class="flex items-center justify-between border-b border-slate-200 pb-2">
		<div>
			<a href="/app/conversations" class="text-xs text-slate-500 hover:underline">← Inbox</a>
			<h1 class="text-base font-semibold text-slate-900">{who}</h1>
		</div>
		{#if data.conversation.bookingRequestId}
			<a href="/app/booking-requests/{data.conversation.bookingRequestId}" class="btn-secondary">Open request</a>
		{/if}
	</header>

	{#if form?.message}<p class="mt-2 rounded-panel bg-danger/10 px-3 py-2 text-xs text-danger">{form.message}</p>{/if}

	<ul class="flex-1 space-y-2 overflow-y-auto py-3">
		{#each data.messages as m (m.id)}
			<li class="flex {m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}">
				<div class="max-w-[75%] rounded-lg px-3 py-1.5 text-sm {m.direction === 'OUTBOUND' ? 'bg-brand-500 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200'}">
					<p class="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</p>
					<p class="mt-0.5 text-[10px] {m.direction === 'OUTBOUND' ? 'text-white/70' : 'text-slate-400'}">
						<TimeAgo value={m.createdAt} timezone={data.tenant.timezone} /> · {m.status.toLowerCase()}
						{#if m.errorMessage}· <span class="text-danger/40">{m.errorMessage}</span>{/if}
					</p>
				</div>
			</li>
		{:else}
			<li class="py-10 text-center text-xs text-slate-500">No messages yet.</li>
		{/each}
	</ul>

	{#if canSend}
		<form method="POST" action="?/send" use:enhance class="flex gap-2 border-t border-slate-200 pt-2">
			<input name="text" placeholder="Type a message…" class="input" autocomplete="off" />
			<button class="btn-primary">Send</button>
		</form>
	{/if}
</div>
