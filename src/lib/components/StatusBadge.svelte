<script lang="ts">
	// One vocabulary of status colours across every table, so an operator learns the
	// colour once rather than per screen.
	let { value, size = 'sm' }: { value: string | null | undefined; size?: 'sm' | 'xs' } = $props();

	const TONES: Record<string, string> = {
		NEW: 'bg-blue-50 text-blue-700 ring-blue-200',
		UNDER_REVIEW: 'bg-amber-50 text-amber-700 ring-amber-200',
		CONTACTED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
		QUOTED: 'bg-violet-50 text-violet-700 ring-violet-200',
		ACCEPTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		DECLINED: 'bg-red-50 text-red-700 ring-red-200',
		CANCELLED: 'bg-slate-100 text-slate-600 ring-slate-200',
		CONVERTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
		PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
		AWAITING_PAYMENT: 'bg-orange-50 text-orange-700 ring-orange-200',
		PARTIALLY_PAID: 'bg-yellow-50 text-yellow-800 ring-yellow-200',
		CONFIRMED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		IN_PROGRESS: 'bg-sky-50 text-sky-700 ring-sky-200',
		COMPLETED: 'bg-teal-50 text-teal-700 ring-teal-200',
		REFUNDED: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
		SENT: 'bg-blue-50 text-blue-700 ring-blue-200',
		VIEWED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
		EXPIRED: 'bg-slate-100 text-slate-500 ring-slate-200',
		SUCCEEDED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		PROCESSING: 'bg-sky-50 text-sky-700 ring-sky-200',
		FAILED: 'bg-red-50 text-red-700 ring-red-200',
		CONNECTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		DISCONNECTED: 'bg-slate-100 text-slate-600 ring-slate-200',
		REAUTH_REQUIRED: 'bg-amber-50 text-amber-800 ring-amber-200',
		ERROR: 'bg-red-50 text-red-700 ring-red-200',
		ACTIVE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		REVOKED: 'bg-red-50 text-red-700 ring-red-200',
		SUSPENDED: 'bg-red-50 text-red-700 ring-red-200',
		TRIAL: 'bg-blue-50 text-blue-700 ring-blue-200',
		WON: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		LOST: 'bg-slate-100 text-slate-500 ring-slate-200',
		QUALIFIED: 'bg-teal-50 text-teal-700 ring-teal-200',
		NEGOTIATING: 'bg-violet-50 text-violet-700 ring-violet-200',
		DELIVERED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
		READ: 'bg-teal-50 text-teal-700 ring-teal-200',
		QUEUED: 'bg-slate-100 text-slate-600 ring-slate-200'
	};

	const tone = $derived(TONES[value ?? ''] ?? 'bg-slate-100 text-slate-600 ring-slate-200');
	const label = $derived((value ?? '—').replace(/_/g, ' ').toLowerCase());
</script>

<span class="badge ring-1 ring-inset {tone} {size === 'xs' ? 'text-[10px]' : 'text-xs'} capitalize">{label}</span>
