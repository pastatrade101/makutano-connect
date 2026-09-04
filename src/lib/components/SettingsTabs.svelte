<script lang="ts">
	/*
	 * The Settings tab strip, shared by the settings page and its child routes.
	 *
	 * Links rather than component state, for two reasons: WhatsApp is a real child
	 * route (it kept its own load and four form actions rather than being merged
	 * into this page's), and a link can be sent — the onboarding checklist can now
	 * point straight at the tab it means instead of at "Settings, look around".
	 *
	 * A tab carries an amber dot when its records say something is missing.
	 */
	let {
		active,
		notes = {}
	}: { active: string; notes?: Record<string, boolean | undefined> } = $props();

	const tabs = [
		{ id: 'business', label: 'Business Details', href: '/app/settings' },
		{ id: 'payments', label: 'Payments', href: '/app/settings?tab=payments' },
		{ id: 'whatsapp', label: 'WhatsApp', href: '/app/settings/whatsapp' },
		{ id: 'plan', label: 'Plan & usage', href: '/app/settings?tab=plan' },
		// Straight to the people page, not a summary that only links to it. Team
		// left the sidebar, so this is now the way in.
		{ id: 'team', label: 'Team', href: '/app/crew' }
	];
</script>

<!-- Scrolls rather than wraps on a phone, so the strip stays one line. -->
<div class="-mx-1 overflow-x-auto px-1">
	<div class="flex w-max min-w-full gap-1 border-b border-slate-200">
		{#each tabs as t (t.id)}
			<a
				href={t.href}
				data-sveltekit-noscroll
				aria-current={active === t.id ? 'page' : undefined}
				class="relative -mb-px flex min-h-11 shrink-0 items-center border-b-2 px-3.5 text-[13.5px] font-medium transition {active ===
				t.id
					? 'border-brand-600 text-brand-700'
					: 'border-transparent text-slate-500 hover:text-slate-800'}"
			>
				{t.label}
				{#if notes[t.id]}
					<span class="ml-1.5 inline-block size-1.5 rounded-full bg-warning" title="Needs attention"></span>
				{/if}
			</a>
		{/each}
	</div>
</div>
