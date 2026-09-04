/**
 * The Traccar adapter. The only file in Connect that knows Traccar exists.
 *
 * Traccar's REST API is documented at /api and speaks HTTP Basic with a service
 * account, or a bearer token on newer builds. Both are supported here because
 * which one a deployment has depends on its version, and an operator should not
 * discover that difference through a broken page.
 *
 * Everything returned is normalised into $lib/server/tracking/types. No Traccar
 * shape escapes this module — that is the point of the module.
 *
 * NOT VERIFIED AGAINST A LIVE SERVER. There was no Traccar instance available
 * when this was written, so the request shapes follow the published API and the
 * tests drive a mocked fetch. Treat first contact with a real server as the
 * remaining validation step.
 */
import type { TraccarCredentials } from './credentials';
import { log } from '$lib/server/logger';
import {
	stateForAge,
	type TrackingHistory,
	type TrackingPosition,
	type TrackingProvider,
	type TrackingSnapshot
} from './types';

/** Traccar's position payload, as much of it as we read. */
type TraccarPosition = {
	deviceId?: number;
	latitude?: number;
	longitude?: number;
	altitude?: number;
	/** KNOTS. Traccar reports speed in knots; the rest of Connect thinks in km/h. */
	speed?: number;
	course?: number;
	deviceTime?: string;
	fixTime?: string;
	serverTime?: string;
};

type TraccarDevice = {
	id?: number;
	uniqueId?: string;
	status?: string;
	lastUpdate?: string;
};

const KNOTS_TO_KPH = 1.852;
/** A page render must never wait longer than this on a third party. */
const TIMEOUT_MS = 6_000;
/** Enough of a track to draw a day; beyond this the response is capped and said so. */
const MAX_POSITIONS = 2_000;

/**
 * What is safe to write into a log line.
 *
 * The operator-facing message never carried a secret, but the LOG did: an error
 * thrown by fetch or by a library can echo the request it was making, and this
 * adapter's request carries an Authorization header. So the configured secrets
 * are stripped from the reason before it is written anywhere, rather than trusted
 * not to appear. Cheap, and the alternative is a token in a log file forever.
 */
function safeReason(err: unknown, credentials?: TraccarCredentials): string {
	let reason = err instanceof Error ? err.message : String(err);
	// The secrets to strip now travel with the CALLER, not with the process:
	// each tenant speaks as itself, so redacting a single ambient credential
	// would have left every per-tenant password free to reach a log.
	for (const secret of [credentials?.password, credentials?.username]) {
		if (secret && secret.length > 3) reason = reason.split(secret).join('[redacted]');
	}
	return reason.slice(0, 200);
}

const parseDate = (value: string | undefined | null): Date | null => {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
};

/** A Traccar position, in Connect's units and names. */
function toPosition(raw: TraccarPosition): TrackingPosition | null {
	const { latitude, longitude } = raw;
	// A device with no fix reports 0,0 — the Gulf of Guinea. Rendering that as a
	// safari vehicle is worse than rendering nothing.
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	if (latitude === 0 && longitude === 0) return null;
	const recordedAt = parseDate(raw.fixTime) ?? parseDate(raw.deviceTime) ?? parseDate(raw.serverTime);
	if (!recordedAt) return null;
	return {
		latitude: latitude as number,
		longitude: longitude as number,
		altitude: Number.isFinite(raw.altitude) ? (raw.altitude as number) : null,
		speedKph: Number.isFinite(raw.speed) ? Math.round((raw.speed as number) * KNOTS_TO_KPH) : null,
		course: Number.isFinite(raw.course) ? (raw.course as number) : null,
		recordedAt,
		receivedAt: parseDate(raw.serverTime)
	};
}

export class TraccarProvider implements TrackingProvider {
	/*
	 * The identity this instance speaks as. REQUIRED, and deliberately not
	 * defaulted to an environment credential.
	 *
	 * This class used to read the shared administrator out of the environment on
	 * every call, which meant the provider's own permission system was inert:
	 * every query ran as the platform. Now an instance cannot exist without
	 * someone having decided, explicitly, whose eyes it sees through — and for a
	 * request handler that is always the authenticated tenant's read-only
	 * identity.
	 */
	constructor(private readonly credentials: TraccarCredentials) {}

	readonly name = 'TRACCAR';

	private get base(): string {
		return (this.credentials.baseUrl || '').replace(/\/+$/, '');
	}

	isConfigured(): boolean {
		return Boolean(this.base && this.credentials.username && this.credentials.password);
	}

	/** Basic or bearer, whichever the deployment configured. Never logged. */
	private authHeader(): string {
		// Basic only. A bearer would need an expiry/renewal ladder to buy nothing
		// here, and the provider's PBKDF2 costs about a millisecond per request.
		const pair = `${this.credentials.username}:${this.credentials.password}`;
		return `Basic ${Buffer.from(pair, 'utf8').toString('base64')}`;
	}

	private async request<T>(path: string, query: Record<string, string> = {}): Promise<T> {
		const qs = Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
		try {
			const res = await fetch(`${this.base}/api${path}${qs}`, {
				headers: { Authorization: this.authHeader(), Accept: 'application/json' },
				signal: controller.signal
			});
			const text = await res.text();
			clearTimeout(timer);
			if (!res.ok) {
				// The status is useful; the body may echo the query string, so it is not
				// carried into anything an operator will read.
				throw new Error(`traccar_http_${res.status}`);
			}
			return JSON.parse(text) as T;
		} catch (err) {
			clearTimeout(timer);
			throw err instanceof Error ? err : new Error('traccar_request_failed');
		}
	}

	/**
	 * Latest position and device state.
	 *
	 * SEQUENTIAL ON PURPOSE, and this is a security property rather than a style
	 * choice.
	 *
	 * /api/positions accepts deviceId. It does NOT accept uniqueId — it silently
	 * IGNORES the parameter and returns the newest fix for every device the token
	 * can see. Verified against Traccar 6.15.3:
	 *
	 *   GET /api/positions?uniqueId=DEFINITELY-NOT-A-REAL-DEVICE
	 *   -> [{"deviceId":1,"latitude":-3.38,...}]      // a real, unrelated device
	 *
	 * This code used to pass uniqueId and take positions[0], so with more than one
	 * tracker registered a trip would have shown an ARBITRARY vehicle's position —
	 * and because the token is one shared account, that arbitrary vehicle could
	 * belong to another tenant. It was invisible only because exactly one device
	 * existed. An operator watching the wrong vehicle is worse than an operator
	 * watching none.
	 *
	 * So the reference is resolved to a numeric id through /devices (which DOES
	 * honour uniqueId — a bogus one returns []), and the position query is scoped
	 * by that id. If the reference does not resolve there is no fallback: an
	 * unscoped query is exactly the bug.
	 */
	async snapshot(deviceRef: string): Promise<TrackingSnapshot> {
		// Defensive only — the service checks this first. Unconfigured is NOT a
		// failure, so it must never surface as UNAVAILABLE.
		if (!this.isConfigured()) return { state: 'NOT_CONFIGURED', position: null };
		try {
			const devices = await this.request<TraccarDevice[]>('/devices', { uniqueId: deviceRef });
			const device = devices.find((d) => d.uniqueId === deviceRef);
			// A reference the provider does not know is OFFLINE, never an excuse to
			// ask an unscoped question.
			if (!device) return { state: 'OFFLINE', position: null, providerOnline: null };

			const positions = await this.request<TraccarPosition[]>('/positions', { deviceId: String(device.id) });
			const position =
				positions
					.filter((raw) => raw.deviceId === undefined || raw.deviceId === device.id)
					.map(toPosition)
					.find((p): p is TrackingPosition => p !== null) ?? null;
			const providerOnline = device?.status ? device.status.toLowerCase() === 'online' : null;

			// The provider's own word beats an age calculation only when it says the
			// device is gone; a device Traccar calls online with a week-old fix is
			// still stale, and the age is what an operator can act on.
			const state = position ? stateForAge(position.recordedAt) : providerOnline === false ? 'OFFLINE' : 'OFFLINE';
			return { state, position, providerOnline };
		} catch (err) {
			log.warn('tracking_snapshot_failed', { provider: this.name, reason: safeReason(err, this.credentials) });
			// A real request that really failed — the one case UNAVAILABLE describes.
			return { state: 'UNAVAILABLE', position: null, message: 'Tracking is temporarily unavailable.' };
		}
	}

	/**
	 * Every device's latest position in ONE request.
	 *
	 * /api/positions with no parameters returns the newest fix for each device the
	 * token can see, so a fleet list costs one call regardless of its length. The
	 * alternative — snapshot() per row — is how a ten-vehicle page becomes twenty
	 * outbound requests and starts timing out for everybody.
	 */
	async snapshotAll(deviceRefs: string[]): Promise<Map<string, TrackingSnapshot>> {
		const out = new Map<string, TrackingSnapshot>();
		if (!deviceRefs.length || !this.isConfigured()) return out;
		try {
			// Positions carry a numeric deviceId, not the reference we store, so the
			// device list is what maps one to the other.
			const [devices, positions] = await Promise.all([
				this.request<TraccarDevice[]>('/devices'),
				this.request<(TraccarPosition & { deviceId?: number })[]>('/positions')
			]);
			const refById = new Map(devices.map((d) => [d.id, d.uniqueId]));
			const onlineByRef = new Map(devices.map((d) => [d.uniqueId, d.status?.toLowerCase() === 'online']));

			for (const raw of positions) {
				const ref = refById.get(raw.deviceId);
				if (!ref || !deviceRefs.includes(ref)) continue;
				const position = toPosition(raw);
				if (!position) continue;
				out.set(ref, {
					state: stateForAge(position.recordedAt),
					position,
					providerOnline: onlineByRef.get(ref) ?? null
				});
			}
			// A mapped device the provider has no position for is OFFLINE, not absent:
			// the caller asked about it and deserves an answer.
			for (const ref of deviceRefs) {
				if (!out.has(ref)) out.set(ref, { state: 'OFFLINE', position: null, providerOnline: onlineByRef.get(ref) ?? null });
			}
			return out;
		} catch (err) {
			log.warn('tracking_snapshot_all_failed', { provider: this.name, reason: safeReason(err, this.credentials) });
			// One failed call must not make the whole fleet look offline — say
			// unavailable, which is the truth, and let the page render.
			for (const ref of deviceRefs) out.set(ref, { state: 'UNAVAILABLE', position: null });
			return out;
		}
	}

	/** Scoped by numeric device id for the same reason snapshot() is. */
	async history(deviceRef: string, from: Date, to: Date): Promise<TrackingHistory> {
		if (!this.isConfigured()) return { positions: [], from, to, truncated: false };
		try {
			const devices = await this.request<TraccarDevice[]>('/devices', { uniqueId: deviceRef });
			const device = devices.find((d) => d.uniqueId === deviceRef);
			// Without a resolved id the honest answer is an empty track. Asking
			// unscoped would draw a polyline joining OTHER vehicles' positions.
			if (!device) return { positions: [], from, to, truncated: false };

			const raw = await this.request<TraccarPosition[]>('/positions', {
				deviceId: String(device.id),
				from: from.toISOString(),
				to: to.toISOString()
			});
			const positions = raw
				.filter((p) => p.deviceId === undefined || p.deviceId === device.id)
				.map(toPosition)
				.filter((p): p is TrackingPosition => p !== null)
				.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
			return {
				positions: positions.slice(0, MAX_POSITIONS),
				from,
				to,
				truncated: positions.length > MAX_POSITIONS
			};
		} catch (err) {
			log.warn('tracking_history_failed', { provider: this.name, reason: safeReason(err, this.credentials) });
			return { positions: [], from, to, truncated: false };
		}
	}
}
