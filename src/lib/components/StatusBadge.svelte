<script lang="ts">
	// One vocabulary of status colours across every table, so an operator learns the
	// colour once rather than per screen.
	import { statusLabel } from '$lib/labels';
	let { value, size = 'sm' }: { value: string | null | undefined; size?: 'sm' | 'xs' } = $props();

	const TONES: Record<string, string> = {
		NEW: 'bg-brand-50 text-brand-600',
		UNDER_REVIEW: 'bg-warning/10 text-warning',
		CONTACTED: 'bg-purple/10 text-purple',
		QUOTED: 'bg-purple/10 text-purple',
		ACCEPTED: 'bg-success/10 text-success',
		DECLINED: 'bg-danger/10 text-danger',
		CANCELLED: 'bg-slate-100 text-slate-500',
		CONVERTED: 'bg-success/10 text-success',
		DRAFT: 'bg-slate-100 text-slate-500',
		PENDING: 'bg-warning/10 text-warning',
		AWAITING_PAYMENT: 'bg-orange/10 text-orange',
		PARTIALLY_PAID: 'bg-warning/10 text-warning',
		CONFIRMED: 'bg-success/10 text-success',
		IN_PROGRESS: 'bg-info/10 text-info',
		COMPLETED: 'bg-info/10 text-info',
		REFUNDED: 'bg-purple/10 text-purple',
		SENT: 'bg-brand-50 text-brand-600',
		VIEWED: 'bg-purple/10 text-purple',
		EXPIRED: 'bg-slate-100 text-slate-400',
		SUCCEEDED: 'bg-success/10 text-success',
		PROCESSING: 'bg-info/10 text-info',
		FAILED: 'bg-danger/10 text-danger',
		CONNECTED: 'bg-success/10 text-success',
		DISCONNECTED: 'bg-slate-100 text-slate-500',
		REAUTH_REQUIRED: 'bg-warning/10 text-warning',
		ERROR: 'bg-danger/10 text-danger',
		ACTIVE: 'bg-success/10 text-success',
		REVOKED: 'bg-danger/10 text-danger',
		SUSPENDED: 'bg-danger/10 text-danger',
		TRIAL: 'bg-brand-50 text-brand-600',
		WON: 'bg-success/10 text-success',
		LOST: 'bg-slate-100 text-slate-400',
		QUALIFIED: 'bg-info/10 text-info',
		NEGOTIATING: 'bg-purple/10 text-purple',
		DELIVERED: 'bg-success/10 text-success',
		READ: 'bg-info/10 text-info',
		QUEUED: 'bg-slate-100 text-slate-500',
		PENDING_CONFIRMATION: 'bg-warning/10 text-warning',
		DISPATCHED: 'bg-info/10 text-info',
		UNPAID: 'bg-danger/10 text-danger',
		PAID: 'bg-success/10 text-success'
	};

	const tone = $derived(TONES[value ?? ''] ?? 'bg-slate-100 text-slate-600 ring-slate-200');
	const label = $derived(statusLabel(value));
</script>

<span class="badge {tone} {size === 'xs' ? 'text-[10px]' : 'text-xs'}">{label}</span>
