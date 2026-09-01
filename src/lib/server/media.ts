// Cloudflare R2 storage for marketplace media (§35).
//
// Modelled on Goldfinch's `r2.service.ts`, which already runs this bucket in
// production, so the two agree on endpoint shape and cache headers.
//
// THE CREDENTIAL RULE: the account id, access key and secret live here and go
// no further. No API returns them, no page renders them, and no browser-side
// upload URL is minted from them — bytes are proxied through Connect. The only
// R2 value a browser ever sees is the public CDN URL of an object.
//
// THE KEY RULE: an object key is COMPOSED HERE out of ids the server already
// resolved, never out of anything a browser sent — not a filename, not a path,
// not a tenant id. Before composing a tenant prefix `uploadMedia` re-checks that
// the tour really belongs to that tenant, so a caller that pairs one tenant with
// another's tour is refused rather than believed; that check is the whole of
// what keeps two operators' folders apart. `objectKey` is also the private
// handle that can DELETE an object, so it never leaves the server — routes
// project rows through `publicMedia`.
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from './db';
import { assertAllowed } from './entitlements';
import { env } from './env';
import { AppError } from './errors';
import { parseUuid } from './http';
import { log } from './logger';

/** Everything R2 needs, or the feature is simply off. */
export function mediaEnabled(): boolean {
	const e = env();
	return Boolean(
		e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET_NAME && e.R2_PUBLIC_URL
	);
}

let client: S3Client | null = null;
const r2 = (): S3Client => {
	if (!mediaEnabled()) {
		throw new AppError('NOT_CONFIGURED', 'Media storage is not configured.');
	}
	if (!client) {
		const e = env();
		client = new S3Client({
			region: 'auto',
			endpoint: `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			credentials: { accessKeyId: e.R2_ACCESS_KEY_ID, secretAccessKey: e.R2_SECRET_ACCESS_KEY }
		});
	}
	return client;
};

const cleanKey = (key: string) => key.replace(/^\/+/, '');

export const publicUrl = (objectKey: string): string =>
	`${env().R2_PUBLIC_URL.replace(/\/+$/, '')}/${cleanKey(objectKey)}`;

/* ------------------------------------------------------------ limits ----- */

/** What may be stored. Anything else is refused before a byte reaches R2. */
const ALLOWED = new Map<string, string>([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/avif', 'avif']
]);

export const ALLOWED_MIME_TYPES: readonly string[] = [...ALLOWED.keys()];

/** 12 MB. A tour photo far exceeding this is a mistake, not a requirement. */
export const MAX_BYTES = 12 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

/**
 * The declared content type is a claim, not a fact — the browser sends whatever
 * it likes. Checking the file's own signature stops a non-image being stored
 * under an image content type and later served as one from the CDN origin.
 */
function assertLooksLikeImage(bytes: Uint8Array, contentType: string): void {
	let signed = false;
	switch (contentType) {
		case 'image/jpeg':
			signed = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
			break;
		case 'image/png':
			signed = bytes[0] === 0x89 && ascii(bytes, 1, 4) === 'PNG';
			break;
		case 'image/webp':
			signed = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP';
			break;
		case 'image/avif':
			// ISO-BMFF: a four-byte box length, then the 'ftyp' box type.
			signed = ascii(bytes, 4, 8) === 'ftyp';
			break;
	}
	if (!signed) throw new AppError('VALIDATION_ERROR', 'That file is not a valid image.');
}

/* ------------------------------------------------------------- owners ---- */

/**
 * What an asset belongs to.
 *
 * A discriminated union rather than a free-form path because the shape of the
 * key and the value of `tenantId` both follow from the kind — there is no way to
 * ask for a tour prefix without naming the tour, and none to reach a tenant
 * prefix from a platform kind.
 */
export type MediaOwner =
	| { kind: 'platform-country'; countryId: string }
	| { kind: 'platform-destination'; destinationId: string }
	| { kind: 'operator'; tenantId: string }
	| { kind: 'tour-hero'; tenantId: string; tourId: string }
	| { kind: 'tour-gallery'; tenantId: string; tourId: string }
	| { kind: 'itinerary'; tenantId: string; tourId: string; dayId: string };

/** NULL for the platform kinds — that is what `media.tenantId IS NULL` means. */
const ownerTenantId = (owner: MediaOwner): string | null =>
	owner.kind === 'platform-country' || owner.kind === 'platform-destination' ? null : owner.tenantId;

/**
 * Compose the object key.
 *
 * Every id is re-validated as a UUID on the way in. They are server-resolved
 * already, but a key is a path: one id carrying `../` would climb out of its
 * prefix, and the shape check costs nothing.
 */
function buildKey(owner: MediaOwner, ext: string): string {
	const name = `${randomUUID()}.${ext}`;
	switch (owner.kind) {
		case 'platform-country':
			return `marketplace/platform/countries/${parseUuid(owner.countryId, 'country id')}/${name}`;
		case 'platform-destination':
			return `marketplace/platform/destinations/${parseUuid(owner.destinationId, 'destination id')}/${name}`;
		case 'operator':
			return `marketplace/tenants/${parseUuid(owner.tenantId, 'tenant id')}/operator/${name}`;
		case 'tour-hero':
		case 'tour-gallery': {
			const tenantId = parseUuid(owner.tenantId, 'tenant id');
			const tourId = parseUuid(owner.tourId, 'tour id');
			const slot = owner.kind === 'tour-hero' ? 'hero' : 'gallery';
			return `marketplace/tenants/${tenantId}/tours/${tourId}/${slot}/${name}`;
		}
		case 'itinerary': {
			const tenantId = parseUuid(owner.tenantId, 'tenant id');
			const tourId = parseUuid(owner.tourId, 'tour id');
			const dayId = parseUuid(owner.dayId, 'itinerary day id');
			return `marketplace/tenants/${tenantId}/tours/${tourId}/itinerary/${dayId}/${name}`;
		}
	}
	// Unreachable through the union; a kind arriving from unchecked JS is refused
	// rather than allowed to compose a key containing `undefined`.
	throw new AppError('VALIDATION_ERROR', 'Unknown media owner.');
}

/** A tour the tenant does not own must fail exactly like a tour that never existed. */
async function assertTourOwned(tenantId: string, tourId: string): Promise<void> {
	const [row] = await db()
		.select({ id: schema.tours.id })
		.from(schema.tours)
		.where(and(eq(schema.tours.id, tourId), eq(schema.tours.tenantId, tenantId), isNull(schema.tours.deletedAt)))
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'That tour could not be found.');
}

/**
 * Prove the owner exists — and, for the tenant kinds, that the tenant really
 * owns it — BEFORE any byte is stored. Verifying afterwards would already have
 * written into the prefix it was meant to protect.
 */
async function assertOwner(owner: MediaOwner): Promise<void> {
	switch (owner.kind) {
		case 'platform-country': {
			const [row] = await db()
				.select({ id: schema.countries.id })
				.from(schema.countries)
				.where(eq(schema.countries.id, owner.countryId))
				.limit(1);
			if (!row) throw new AppError('NOT_FOUND', 'That country could not be found.');
			return;
		}
		case 'platform-destination': {
			const [row] = await db()
				.select({ id: schema.destinations.id })
				.from(schema.destinations)
				.where(eq(schema.destinations.id, owner.destinationId))
				.limit(1);
			if (!row) throw new AppError('NOT_FOUND', 'That destination could not be found.');
			return;
		}
		case 'operator': {
			const [row] = await db()
				.select({ id: schema.tenants.id })
				.from(schema.tenants)
				.where(and(eq(schema.tenants.id, owner.tenantId), isNull(schema.tenants.deletedAt)))
				.limit(1);
			if (!row) throw new AppError('NOT_FOUND', 'That operator could not be found.');
			return;
		}
		case 'tour-hero':
		case 'tour-gallery':
			await assertTourOwned(owner.tenantId, owner.tourId);
			return;
		case 'itinerary': {
			await assertTourOwned(owner.tenantId, owner.tourId);
			const [day] = await db()
				.select({ id: schema.tourItineraryDays.id })
				.from(schema.tourItineraryDays)
				.where(and(eq(schema.tourItineraryDays.id, owner.dayId), eq(schema.tourItineraryDays.tourId, owner.tourId)))
				.limit(1);
			if (!day) throw new AppError('NOT_FOUND', 'That itinerary day could not be found.');
			return;
		}
	}
}

/* ------------------------------------------------------------ storage ---- */

async function putObject(objectKey: string, body: Uint8Array, contentType: string): Promise<string> {
	await r2().send(
		new PutObjectCommand({
			Bucket: env().R2_BUCKET_NAME,
			Key: cleanKey(objectKey),
			Body: body,
			ContentType: contentType,
			// Keys are random and an object is never rewritten, so it can be cached hard.
			CacheControl: 'public, max-age=31536000, immutable'
		})
	);
	return publicUrl(objectKey);
}

/**
 * Best-effort delete of the stored object.
 *
 * By the time this runs the row is already gone, so a failure here leaves litter
 * in a bucket rather than a broken page — it is logged, not thrown.
 */
async function deleteObject(objectKey: string): Promise<void> {
	try {
		await r2().send(new DeleteObjectCommand({ Bucket: env().R2_BUCKET_NAME, Key: cleanKey(objectKey) }));
	} catch (err) {
		log.error('r2_delete_failed', { objectKey, error: (err as Error)?.message });
	}
}

/* -------------------------------------------------------------- media ---- */

export type UploadOptions = {
	altText?: string | null;
	/** Intrinsic pixel size, when the caller knows it — nothing here decodes images. */
	width?: number | null;
	height?: number | null;
	createdBy?: string | null;
};

/**
 * Store bytes and record them.
 *
 * Type, size and signature are all checked before the PUT, so a bad upload never
 * reaches the bucket. The object goes first and the row second: a row without an
 * object is a broken image on a public page, while an object without a row is
 * only litter — the same trade the delete path makes in the other direction.
 *
 * No audit row is written here. Only the caller knows whether this became a
 * hero, a gallery entry or a day photo, so it owns `tour.media_added`.
 */
export async function uploadMedia(
	owner: MediaOwner,
	bytes: Uint8Array,
	contentType: string,
	opts: UploadOptions = {}
): Promise<schema.Media> {
	const ext = ALLOWED.get(contentType);
	if (!ext) throw new AppError('VALIDATION_ERROR', `Unsupported image type: ${contentType}`);
	if (!bytes.byteLength) throw new AppError('VALIDATION_ERROR', 'That file is empty.');
	if (bytes.byteLength > MAX_BYTES) {
		throw new AppError('VALIDATION_ERROR', `Image is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`);
	}
	assertLooksLikeImage(bytes, contentType);

	const tenantId = ownerTenantId(owner);
	if (tenantId) await assertAllowed(tenantId);
	await assertOwner(owner);

	const objectKey = buildKey(owner, ext);
	const url = await putObject(objectKey, bytes, contentType);

	const [row] = await db()
		.insert(schema.media)
		.values({
			tenantId,
			objectKey,
			url,
			mimeType: contentType,
			size: bytes.byteLength,
			width: opts.width ?? null,
			height: opts.height ?? null,
			altText: opts.altText?.trim() || null,
			createdBy: opts.createdBy ?? null
		})
		.returning();
	return row;
}

/**
 * Who is allowed to delete a given row.
 *
 * A tenant reaches only rows carrying its own id; the platform reaches only the
 * platform-owned ones. Neither can cross into the other's half — an admin
 * clearing out a tenant's folder would be a deliberate, separately audited
 * operation, not a side effect of this one.
 */
export type MediaScope = { kind: 'tenant'; tenantId: string } | { kind: 'platform' };

/**
 * Remove a media row and then its object.
 *
 * The scope is part of the DELETE rather than a preceding SELECT, so there is no
 * window between checking ownership and acting on it, and a row outside the
 * scope is indistinguishable from one that does not exist. Foreign keys do the
 * unlinking: hero and itinerary references null out, gallery rows cascade away.
 */
export async function deleteMedia(id: string, scope: MediaScope): Promise<void> {
	const mediaId = parseUuid(id, 'media id');
	if (scope.kind === 'tenant') await assertAllowed(scope.tenantId);

	const owned = scope.kind === 'tenant' ? eq(schema.media.tenantId, scope.tenantId) : isNull(schema.media.tenantId);

	const [row] = await db()
		.delete(schema.media)
		.where(and(eq(schema.media.id, mediaId), owned))
		.returning({ objectKey: schema.media.objectKey, storageProvider: schema.media.storageProvider });
	if (!row) throw new AppError('NOT_FOUND', 'That image could not be found.');

	// Only bytes we hold get deleted. A row can point at a file on somebody
	// else's storage — imported demo listings do — and firing a DeleteObject at
	// our own bucket with a foreign key deletes nothing while logging a failure
	// that reads like a real one.
	if (row.storageProvider === 'R2') await deleteObject(row.objectKey);
}

/** The only fields of a media row that may leave the server. */
export type PublicMedia = {
	id: string;
	url: string;
	altText: string | null;
	width: number | null;
	height: number | null;
};

/**
 * Project a row for a response.
 *
 * Spelled out field by field so that `objectKey`, `tenantId` and `createdBy`
 * cannot ride along into a public payload the way a spread would let them.
 */
export function publicMedia(row: schema.Media | null | undefined): PublicMedia | null {
	if (!row) return null;
	return { id: row.id, url: row.url, altText: row.altText, width: row.width, height: row.height };
}
