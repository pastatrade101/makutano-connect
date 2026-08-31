// Attach local photographs to a tour listing.
//
// Same path the composer's uploadPhoto action takes — uploadMedia() into R2,
// then setTourGallery(), then the first photo becomes the hero if none is set.
// It exists because the browser automation driving this test cannot open a file
// picker; a human using the composer clicks Upload and gets exactly this.
//
//   node --experimental-strip-types scripts/attach-tour-photos.ts <tourId> <slug> file...
//
// The tenant is derived FROM THE TOUR, never passed in: the whole point of the
// ownership check in the action is that bytes must not reach a tenant's folder
// before the server has confirmed the listing is theirs.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema, closeDb } from '../src/lib/server/db/index.ts';
import { uploadMedia, MAX_BYTES } from '../src/lib/server/media.ts';
import { getTourDetail, setTourGallery, updateTour } from '../src/lib/server/tours.ts';

const [tourId, ...files] = process.argv.slice(2);
if (!tourId || !files.length) {
	console.error('usage: attach-tour-photos.ts <tourId> <file>...');
	process.exit(1);
}

const MIME: Record<string, string> = {
	'.avif': 'image/avif',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp'
};

const [tour] = await db()
	.select({ id: schema.tours.id, tenantId: schema.tours.tenantId, title: schema.tours.title })
	.from(schema.tours)
	.where(and(eq(schema.tours.id, tourId), isNull(schema.tours.deletedAt)))
	.limit(1);
if (!tour) {
	console.error(`no live tour ${tourId}`);
	process.exit(1);
}
console.log(`tour: ${tour.title}`);

for (const path of files) {
	const bytes = readFileSync(path);
	const type = MIME[extname(path).toLowerCase()];
	if (!type) {
		console.log(`  skip ${basename(path)} — unsupported type`);
		continue;
	}
	if (bytes.byteLength > MAX_BYTES) {
		console.log(`  skip ${basename(path)} — ${Math.round(bytes.byteLength / 1024)}KB over the limit`);
		continue;
	}
	// Ownership first, exactly as the action does it.
	const detail = await getTourDetail(tour.tenantId, tour.id);
	const media = await uploadMedia(
		{ kind: 'tour-gallery', tenantId: tour.tenantId, tourId: tour.id },
		new Uint8Array(bytes),
		type,
		{ altText: null, createdBy: null }
	);
	await setTourGallery(tour.tenantId, tour.id, [...detail.gallery.map((m) => m.id), media.id], {});
	if (!detail.tour.heroMediaId) {
		await updateTour(tour.tenantId, tour.id, { heroMediaId: media.id }, {});
		console.log(`  ${basename(path)} → uploaded, set as MAIN photo`);
	} else {
		console.log(`  ${basename(path)} → uploaded to gallery`);
	}
}

const final = await getTourDetail(tour.tenantId, tour.id);
console.log(`gallery now ${final.gallery.length}, hero ${final.tour.heroMediaId ? 'set' : 'MISSING'}`);
await closeDb();
