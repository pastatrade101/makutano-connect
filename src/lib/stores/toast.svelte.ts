// Reback-style toast notifications. A tiny rune store: push from anywhere in the
// client, the <Toasts /> container in the shells renders and auto-dismisses.
export type ToastKind = 'success' | 'danger' | 'warning' | 'info';
export type Toast = { id: number; kind: ToastKind; title: string; detail?: string };

let seq = 0;
const list = $state<Toast[]>([]);

function push(kind: ToastKind, title: string, detail?: string, timeoutMs = 4500) {
	const id = ++seq;
	list.push({ id, kind, title, detail });
	setTimeout(() => dismiss(id), timeoutMs);
}

export function dismiss(id: number) {
	const i = list.findIndex((t) => t.id === id);
	if (i >= 0) list.splice(i, 1);
}

export const toasts = {
	get list() {
		return list;
	},
	success: (title: string, detail?: string) => push('success', title, detail),
	danger: (title: string, detail?: string) => push('danger', title, detail, 7000),
	warning: (title: string, detail?: string) => push('warning', title, detail),
	info: (title: string, detail?: string) => push('info', title, detail),
	dismiss
};
