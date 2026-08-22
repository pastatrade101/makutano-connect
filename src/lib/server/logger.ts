// Structured JSON logger with hard redaction. §29 forbids raw tokens and secrets in
// logs, so every payload passes through redact() — keys that look secret are masked
// and long bearer-ish strings are truncated, regardless of what a caller passes.
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(token|secret|password|api_?key|authorization|encrypted|cipher|pin|signature|credential)/i;

function threshold(): number {
	return LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? 20;
}

export function redact(value: unknown, depth = 0): unknown {
	if (value == null || depth > 6) return value;
	if (typeof value === 'string') return value.length > 512 ? `${value.slice(0, 512)}…[truncated]` : value;
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = SECRET_KEY.test(k) ? mask(v) : redact(v, depth + 1);
		}
		return out;
	}
	return value;
}

function mask(v: unknown): string {
	if (typeof v !== 'string' || v.length === 0) return '[redacted]';
	return `[redacted:${v.length}]`;
}

function emit(level: Level, event: string, data?: Record<string, unknown>) {
	if (LEVELS[level] < threshold()) return;
	const line = { ts: new Date().toISOString(), level, event, ...(data ? (redact(data) as object) : {}) };
	const text = JSON.stringify(line);
	if (level === 'error') console.error(text);
	else if (level === 'warn') console.warn(text);
	else console.log(text);
}

export const log = {
	debug: (event: string, data?: Record<string, unknown>) => emit('debug', event, data),
	info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
	warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
	error: (event: string, data?: Record<string, unknown>) => emit('error', event, data)
};
