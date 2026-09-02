<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	/*
	 * A password box you can read back.
	 *
	 * Typing a password blind is the commonest cause of a failed sign-in, and the
	 * cost of getting it wrong is highest exactly where it is hardest to type: a
	 * phone keyboard, a generated invite password, a new password being confirmed
	 * against one you cannot see.
	 *
	 * The toggle is a real <button type="button"> — inside a form, a bare <button>
	 * submits it, which would post the form every time somebody wanted to check
	 * their own typing. It is never focusable-by-default before the field itself,
	 * and it announces its state rather than relying on the icon alone.
	 */
	let {
		id,
		name = id,
		label,
		autocomplete = 'current-password',
		required = false,
		value = $bindable(''),
		hint = '',
		class: extra = ''
	}: {
		id: string;
		name?: string;
		label?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		required?: boolean;
		value?: string;
		hint?: string;
		class?: string;
	} = $props();

	let shown = $state(false);
</script>

<div class="relative">
	<input
		{id}
		{name}
		{required}
		{autocomplete}
		bind:value
		type={shown ? 'text' : 'password'}
		class="input pr-11 {extra}"
	/>
	<button
		type="button"
		onclick={() => (shown = !shown)}
		aria-pressed={shown}
		aria-controls={id}
		aria-label={shown ? `Hide ${label ?? 'password'}` : `Show ${label ?? 'password'}`}
		title={shown ? 'Hide' : 'Show'}
		class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-panel text-slate-400 transition hover:text-slate-600 focus:outline-none focus-visible:text-brand-600"
	>
		{#if shown}
			<!-- Struck-through eye: currently visible, pressing hides it again. -->
			<svg class="size-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
				<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
				<circle cx="10" cy="10" r="2.4" />
				<path d="M4 16 16 4" stroke-linecap="round" />
			</svg>
		{:else}
			<svg class="size-[18px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
				<path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10Z" />
				<circle cx="10" cy="10" r="2.4" />
			</svg>
		{/if}
	</button>
</div>
{#if hint}<p class="mt-1 text-[12.5px] text-slate-400">{hint}</p>{/if}
