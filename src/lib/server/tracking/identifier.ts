/**
 * The tracker reference Connect mints.
 *
 * This string is credential material, not a name. Anyone holding it can point a
 * phone at the ingest endpoint and post positions as that vehicle, and it needs
 * no Connect session to use — so it is generated here, shown to one
 * authenticated operator once, and never rendered again.
 *
 * ENTROPY IS SIZED FOR THE POST-BINDING ATTACK, not the pending window. Guessing
 * a live reference to inject false positions has unlimited time and a target
 * pool of every vehicle on the platform, so 15 random characters over a
 * 32-symbol alphabet — 75 bits — is the floor. A short pending window does not
 * reduce this requirement, because the reference stays valid for the life of the
 * tracker.
 *
 * The alphabet is Crockford base32: no I, L, O or U. That is PREVENTION, not
 * correction — the provider compares the reference as a raw string, so a
 * mistyped character produces a device that silently never reports. The 16th
 * character is a check digit so support can say "that code has a character
 * wrong" instead of both parties staring at a device that appears dead.
 */
import crypto from 'node:crypto';

/** Crockford base32: 0-9 and A-Z minus I, L, O, U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAYLOAD_LENGTH = 15;

/**
 * Rejection sampling, not modulo.
 *
 * 256 is not a multiple of 32 here only by luck — it is, so modulo would in fact
 * be uniform for this alphabet. The rejection loop stays because the alphabet is
 * the kind of constant somebody shortens later, and a silent bias in a
 * credential generator is not a bug anybody notices.
 */
function randomChars(count: number): string {
	const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
	let out = '';
	while (out.length < count) {
		for (const byte of crypto.randomBytes(count * 2)) {
			if (byte >= max) continue;
			out += ALPHABET[byte % ALPHABET.length];
			if (out.length === count) break;
		}
	}
	return out;
}

/** One character derived from the payload, so a typo is detectable. */
function checkCharacter(payload: string): string {
	return ALPHABET[crypto.createHash('sha256').update(payload).digest()[0] & 31];
}

/** A fresh reference: 15 random characters plus a check character. */
export function mintDeviceRef(): string {
	const payload = randomChars(PAYLOAD_LENGTH);
	return payload + checkCharacter(payload);
}

/**
 * Whether a typed reference is self-consistent.
 *
 * Only ever used to give a better message on the typed-fallback path. It is NOT
 * an authorisation check: a well-formed reference proves nothing, and the ledger
 * is the only thing that decides who owns a tracker.
 */
export function looksWellFormed(candidate: string): boolean {
	const value = candidate.trim().toUpperCase();
	if (value.length !== PAYLOAD_LENGTH + 1) return false;
	if (![...value].every((c) => ALPHABET.includes(c))) return false;
	return value[PAYLOAD_LENGTH] === checkCharacter(value.slice(0, PAYLOAD_LENGTH));
}

/**
 * Normalise what a human typed.
 *
 * Crockford's own substitutions: I and L read as 1, O reads as 0. Spaces and
 * dashes are what people add to long codes unprompted.
 */
export function normaliseTyped(input: string): string {
	return input
		.trim()
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.replace(/[IL]/g, '1')
		.replace(/O/g, '0');
}
