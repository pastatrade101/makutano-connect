/**
 * What Connect knows about a moving vehicle, in Connect's own words.
 *
 * Nothing a tracking provider returns crosses this boundary. The adapter
 * normalises into these types, and the rest of the product never learns which
 * provider is behind them — which is the whole reason the boundary exists.
 */

/**
 * How much to trust a position, derived from its age.
 *
 * Deliberately NOT "the device exists, therefore live". A tracker parked in a
 * yard with no signal for a week still exists, and calling that LIVE on an
 * operator's screen is the one failure that would make the feature worse than
 * having none: it invites somebody to stop worrying about a vehicle they should
 * be phoning about.
 */
export type TrackingState =
	/** No tracker mapped to this vehicle. Not an error — most vehicles start here. */
	| 'NOT_CONFIGURED'
	/** A fix within LIVE_WITHIN_MS. Safe to say "moving now". */
	| 'LIVE'
	/** Recent enough to act on, old enough not to call live. */
	| 'RECENT'
	/** Hours old. The vehicle is probably out of coverage. */
	| 'STALE'
	/** The provider says the device is not reporting at all. */
	| 'OFFLINE'
	/** We could not reach the provider. Says nothing about the vehicle. */
	| 'UNAVAILABLE';

/** Under five minutes old counts as live. */
export const LIVE_WITHIN_MS = 5 * 60 * 1000;
/** Under an hour still describes now. */
export const RECENT_WITHIN_MS = 60 * 60 * 1000;

export type TrackingPosition = {
	latitude: number;
	longitude: number;
	/** Metres. */
	altitude?: number | null;
	/** km/h, already converted from whatever the provider speaks. */
	speedKph?: number | null;
	/** Degrees from north. */
	course?: number | null;
	/** When the device says it was there. */
	recordedAt: Date;
	/** When the server learned of it, when the provider reports it. */
	receivedAt?: Date | null;
};

export type TrackingSnapshot = {
	state: TrackingState;
	position: TrackingPosition | null;
	/** The provider's own online flag, where it has one. */
	providerOnline?: boolean | null;
	/**
	 * Why the state is UNAVAILABLE, for the operator — never the raw provider
	 * error, which leaks URLs and sometimes credentials into a page.
	 */
	message?: string | null;
};

export type TrackingHistory = {
	positions: TrackingPosition[];
	from: Date;
	to: Date;
	/** True when the provider capped the response and the track is incomplete. */
	truncated: boolean;
};

/**
 * The interface the product codes against.
 *
 * A second provider means a second implementation of this and nothing else —
 * no trip logic, no UI, no route changes.
 */
export interface TrackingProvider {
	readonly name: string;
	/** Configured well enough to be worth calling. */
	isConfigured(): boolean;
	/** Latest position plus device state, in as few calls as the provider allows. */
	snapshot(deviceRef: string): Promise<TrackingSnapshot>;
	history(deviceRef: string, from: Date, to: Date): Promise<TrackingHistory>;
}

/** Age -> state. Exported so the rule is testable without a provider. */
export function stateForAge(recordedAt: Date | null | undefined, now = Date.now()): TrackingState {
	if (!recordedAt) return 'OFFLINE';
	const age = now - recordedAt.getTime();
	// A clock-skewed device reporting the future is not more live than live.
	if (age < LIVE_WITHIN_MS) return 'LIVE';
	if (age < RECENT_WITHIN_MS) return 'RECENT';
	return 'STALE';
}

/** What an operator reads. Kept next to the states so the two cannot drift. */
export const TRACKING_LABEL: Record<TrackingState, string> = {
	NOT_CONFIGURED: 'Tracking not configured',
	LIVE: 'Live',
	RECENT: 'Recently updated',
	STALE: 'Last position is stale',
	OFFLINE: 'Tracker offline',
	UNAVAILABLE: 'Tracking temporarily unavailable'
};
