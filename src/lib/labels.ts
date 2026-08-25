// Business-friendly presentation for internal enum values (§14 of the UX brief).
//
// The enums themselves never change — the API, webhooks and database keep the exact
// same values. This is the one place raw values become words a business owner uses,
// so every screen says "Awaiting confirmation", not PENDING_CONFIRMATION.

const STATUS: Record<string, string> = {
	PENDING_CONFIRMATION: 'Awaiting confirmation',
	AWAITING_PAYMENT: 'Awaiting payment',
	PARTIALLY_PAID: 'Partially paid',
	IN_PROGRESS: 'In progress',
	UNDER_REVIEW: 'Under review',
	REAUTH_REQUIRED: 'Reconnect needed',
	PAST_DUE: 'Payment overdue',
	TRIALING: 'On trial',
	NEW: 'New',
	READY: 'Ready',
	DISPATCHED: 'On its way',
	DELIVERED: 'Delivered',
	CONFIRMED: 'Confirmed',
	COMPLETED: 'Completed',
	CANCELLED: 'Cancelled',
	REFUNDED: 'Refunded',
	UNPAID: 'Unpaid',
	PAID: 'Paid',
	DRAFT: 'Draft',
	SENT: 'Sent',
	VIEWED: 'Viewed',
	ACCEPTED: 'Accepted',
	DECLINED: 'Declined',
	EXPIRED: 'Expired',
	CONVERTED: 'Converted',
	SUCCEEDED: 'Received',
	PROCESSING: 'Processing',
	FAILED: 'Failed',
	CONNECTED: 'Connected',
	DISCONNECTED: 'Not connected',
	QUEUED: 'Sending…',
	APPROVED: 'Approved',
	PENDING: 'Pending',
	REJECTED: 'Needs changes',
	PAUSED: 'Paused',
	SUBMITTED: 'Awaiting approval',
	REQUESTED: 'Requested',
	REPORTED: 'Reported — verify'
};

/** "PENDING_CONFIRMATION" → "Awaiting confirmation". Unknown values degrade gracefully. */
export function statusLabel(value: string | null | undefined): string {
	if (!value) return '—';
	if (STATUS[value]) return STATUS[value];
	const words = value.replace(/_/g, ' ').toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

const SOURCE: Record<string, string> = {
	WHATSAPP_DIRECT: 'WhatsApp',
	WHATSAPP_STATUS: 'WhatsApp status',
	WHATSAPP_GROUP: 'WhatsApp group',
	WHATSAPP: 'WhatsApp',
	WALK_IN: 'Walk-in',
	ORDER_LINK: 'Order link',
	PHONE: 'Phone call',
	WEBSITE: 'Website',
	INSTAGRAM: 'Instagram',
	FACEBOOK: 'Facebook',
	MANUAL: 'Added manually',
	ADMIN: 'Added manually',
	API: 'Your website / API',
	EMAIL: 'Email',
	OTHER: 'Other'
};

/** "WHATSAPP_DIRECT" → "WhatsApp". For pickers, use SOURCE_OPTIONS to keep order. */
export function sourceLabel(value: string | null | undefined): string {
	if (!value) return '—';
	return SOURCE[value] ?? statusLabel(value);
}

/**
 * Messages sent before Connect stored the rendered template text read as
 * "[template:order_ready]". Show the human name and mark it automated, instead of
 * a token no shop owner should ever have to decode.
 */
export function messagePreview(body: string | null | undefined, type?: string | null): string {
	const raw = body ?? '';
	const legacy = /^\[template:([a-z0-9_]+)\]$/i.exec(raw.trim());
	if (legacy) {
		const name = legacy[1]
			.replace(/_/g, ' ')
			.replace(/\bv\d+\b/gi, '')
			.trim();
		return `${name.charAt(0).toUpperCase()}${name.slice(1)} (automated message)`;
	}
	return raw || `[${type ?? 'message'}]`;
}
