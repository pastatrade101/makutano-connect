// Structured JSON logger with hard redaction. §29 forbids raw tokens and secrets in
// logs, so every payload passes through redact() — keys that look secret are masked
// and long bearer-ish strings are truncated, regardless of what a caller passes.
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY = /(token|secret|password|api_?key|authorization|encrypted|cipher|pin|signature|credential)/i;

/**
 * Keys whose VALUE is a URL or path, where a credential can hide in plain sight.
 *
 * SECRET_KEY masks by key NAME, so `{ token: '…' }` is caught — but the public
 * quotation link carries its credential in the PATH, and a 5xx logged
 * `{ path: '/api/public/quotations/<token>/accept' }` verbatim. That writes a live
 * bearer token into log aggregation, where it outlives the quote: anyone reading
 * the line could open the traveller's quotation and, while it was still open,
 * accept it.
 */
const PATH_KEY = /^(path|pathname|url|href|referer|referrer)$/i;

/**
 * Replace credential-shaped path segments, and nothing else.
 *
 * Deliberately narrow: 32+ unbroken hex characters. That is the shape of the
 * quotation and review tokens (40 hex from two UUIDs) and is not the shape of a
 * UUID, which carries dashes — so record ids stay readable and a log line is
 * still worth reading when something goes wrong.
 */
export function redactPath(value: string): string {
	return value.replace(/\b[0-9a-f]{32,}\b/gi, '[redacted:token]');
}

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
			if (SECRET_KEY.test(k)) out[k] = mask(v);
			else if (PATH_KEY.test(k) && typeof v === 'string') out[k] = redactPath(v);
			else out[k] = redact(v, depth + 1);
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
