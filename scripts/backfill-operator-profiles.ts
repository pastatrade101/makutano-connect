// Tenants that have listings but no public operator profile.
//
//   node --experimental-strip-types scripts/backfill-operator-profiles.ts [--apply]
//
// WHY THIS EXISTS
//
// The marketplace's promise is "run by the operator who listed it", so
// createTour() calls ensureOperatorProfile() as its first step — a listing with
// nobody behind it renders as an empty card on the public site.
//
// Bulk import scripts write tour rows directly and skip that call. This finds
// what they missed. It is a repair, not a feature: the fix for new imports is in
// the importer itself.
//
// Dry run by default. It never sets is_verified — verification is a platform
// judgement made on the operator's own admin page, and a badge handed out by a
// backfill is not a signal.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql as raw } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema.ts';

const APPLY = process.argv.includes('--apply');
const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.');
	process.exit(1);
}

const client = postgres(dbUrl, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });

/** Same shape as tourSlug() in src/lib/server/tours.ts:125. */
const slugify = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80)
		.replace(/-+$/, '') || 'operator';

const gaps = await db.execute(raw`
	select t.id, t.slug, t.name, t.country, count(o.id)::int as listings,
	       count(*) filter (where o.status = 'PUBLISHED')::int as published
	from tenants t
	join tours o on o.tenant_id = t.id and o.deleted_at is null
	left join operator_profiles p on p.tenant_id = t.id
	where p.id is null
	group by t.id, t.slug, t.name, t.country
	order by published desc, listings desc
`);

if (!gaps.length) {
	console.log('Every tenant with listings has an operator profile.');
} else {
	console.log(`${APPLY ? 'BACKFILL' : 'DRY RUN'}  ${gaps.length} tenant(s) with listings and no operator profile\n`);
}
for (const row of gaps as unknown as {
	id: string;
	slug: string;
	name: string;
	country: string | null;
	listings: number;
	published: number;
}[]) {
	const label = `${row.name} (${row.slug})`;
	// A published listing with no operator is already visible to the public, so it
	// is called out rather than counted — that is the one worth fixing today.
	const live = row.published > 0 ? `  ** ${row.published} ALREADY PUBLISHED with no operator **` : '';
	console.log(`  ${label.padEnd(34)} listings=${row.listings}${live}`);

	if (!APPLY) continue;

	const base = slugify(row.slug || row.name);
	for (let attempt = 0; attempt < 25; attempt++) {
		const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
		try {
			await db
				.insert(schema.operatorProfiles)
				// Every field ensureOperatorProfile() writes, and no more. A backfill that
				// produces a different row than the real code path leaves two kinds of
				// profile behind, which is worse than the gap it closed. (It writes the
				// tenant's country code into `location` — a wart worth knowing about,
				// but not one to diverge over.)
				.values({ tenantId: row.id, slug, displayName: row.name, location: row.country, isActive: true });
			console.log(`      created profile: ${slug}`);
			break;
		} catch {
			const [raced] = await db
				.select({ id: schema.operatorProfiles.id })
				.from(schema.operatorProfiles)
				.where(eq(schema.operatorProfiles.tenantId, row.id))
				.limit(1);
			if (raced) break;
			if (attempt === 24) throw new Error(`Could not create a profile for ${label}.`);
		}
	}
}

/* ------------------------------------------------------- legacy logos ---- */

/*
 * A logo that exists but nothing points at.
 *
 * `tenants.logo_url` was once a free-text box on the settings page; the
 * marketplace has always rendered `operator_profiles.logo_media_id`. Operators
 * who typed a URL into that box saw their storefront stay blank — and had no way
 * to tell why. The box is gone and uploads now mirror both ways, but the
 * operators who already used it need their existing image adopted.
 *
 * Only URLs already in our own media host are adopted: a row is a handle the
 * product may later resize or delete, and pointing one at somebody else's server
 * would be claiming a file we do not hold.
 */
const mediaHost = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

const orphanLogos = await db.execute(raw`
	select t.id as tenant_id, t.name, t.logo_url, p.id as profile_id
	from tenants t
	join operator_profiles p on p.tenant_id = t.id
	where t.deleted_at is null
	  and t.logo_url is not null and t.logo_url <> ''
	  and p.logo_media_id is null
`);

if (orphanLogos.length) {
	console.log(`\n${APPLY ? 'ADOPT' : 'DRY RUN'}  ${orphanLogos.length} operator(s) with a logo the marketplace cannot see`);
	for (const row of orphanLogos as unknown as { tenant_id: string; name: string; logo_url: string; profile_id: string }[]) {
		const ours = mediaHost && row.logo_url.startsWith(mediaHost);
		console.log(`  ${row.name.padEnd(24)} ${ours ? 'adoptable' : 'SKIPPED — not on our media host'}  ${row.logo_url}`);
		if (!ours || !APPLY) continue;

		const key = row.logo_url.slice(mediaHost.length).replace(/^\/+/, '');
		const ext = key.split('.').pop()?.toLowerCase() ?? '';
		const mime =
			ext === 'avif' ? 'image/avif'
			: ext === 'webp' ? 'image/webp'
			: ext === 'png' ? 'image/png'
			: 'image/jpeg';

		const [media] = await db
			.insert(schema.media)
			.values({
				tenantId: row.tenant_id,
				storageProvider: 'R2',
				objectKey: key,
				url: row.logo_url,
				mimeType: mime,
				altText: `${row.name} logo`
			})
			.returning({ id: schema.media.id });

		await db
			.update(schema.operatorProfiles)
			.set({ logoMediaId: media.id, updatedAt: new Date() })
			.where(eq(schema.operatorProfiles.tenantId, row.tenant_id));
		console.log(`      linked as media ${media.id}`);
	}
}

if (!APPLY) console.log('\nDry run. Nothing was written. Re-run with --apply.');
await client.end();
