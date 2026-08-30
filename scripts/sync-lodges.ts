// Pull a tenant's accommodations from their own system into Connect's catalog.
//
//   npm run sync:lodges -- --tenant=goldfinch --url=https://goldfinch-api.makutano.co.tz/api/lodges
//
// WHY A PULL, WHEN THE DESIGN SAYS THE TENANT PUSHES: the push is the right
// long-term shape — a tenant's CMS stays the source of truth and posts to
// /api/v1/catalog like it already does for quotations and bookings. This script
// exists because that push has to be written on the tenant's side, and until it
// is, the picker has nothing to offer. It is idempotent and keyed on the source
// id, so running it repeatedly converges, and the day the push lands this can be
// deleted without unpicking anything.
//
// Load env first: `set -a; . ./.env; set +a`
import postgres from 'postgres';

type Lodge = {
	id: string;
	name: string;
	slug?: string;
	accommodation_level?: string | null;
	lodge_type?: string | null;
	description?: string | null;
};

const arg = (name: string): string | undefined =>
	process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const tenantSlug = arg('tenant');
const url = arg('url');
if (!tenantSlug || !url) {
	console.error('Usage: --tenant=<slug> --url=<lodges endpoint>');
	process.exit(1);
}

const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
	console.error('Set DIRECT_DATABASE_URL or DATABASE_URL.');
	process.exit(1);
}

/** Tolerates a bare array, {data:[…]}, or {data:{items:[…]}}. */
function itemsFrom(payload: unknown): Lodge[] {
	if (Array.isArray(payload)) return payload as Lodge[];
	const data = (payload as { data?: unknown })?.data;
	if (Array.isArray(data)) return data as Lodge[];
	const items = (data as { items?: unknown })?.items;
	return Array.isArray(items) ? (items as Lodge[]) : [];
}

type Pagination = { page?: number; totalPages?: number; total?: number };
const paginationFrom = (payload: unknown): Pagination =>
	((payload as { data?: { pagination?: Pagination } })?.data?.pagination ?? {}) as Pagination;

/**
 * Every page, not just the first.
 *
 * This mattered more than it looks: the source defaults to 10 per page, and the
 * retire step below deactivates anything it did not see. A single-page fetch
 * would therefore have RETIRED the 45 lodges it never asked for — a sync that
 * quietly deletes most of the catalogue is worse than no sync at all.
 */
async function fetchAll(base: string): Promise<Lodge[]> {
	const all: Lodge[] = [];
	let page = 1;
	let pages = 1;
	do {
		const url = new URL(base);
		url.searchParams.set('page', String(page));
		if (!url.searchParams.has('limit')) url.searchParams.set('limit', '100');
		const response = await fetch(url, { headers: { accept: 'application/json' } });
		if (!response.ok) throw new Error(`${url} returned ${response.status}`);
		const payload = await response.json();
		all.push(...itemsFrom(payload));
		const meta = paginationFrom(payload);
		pages = Math.max(1, Number(meta.totalPages ?? 1));
		page++;
	} while (page <= pages);

	// If the source told us a total, insist we actually got it before touching
	// anything — a truncated fetch must not be mistaken for a shrunken source.
	return all;
}

/** "MID_RANGE" / "TENTED_CAMP" → "Mid range · Tented camp", for a human list. */
const humanise = (v?: string | null) =>
	v ? v.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null;

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

try {
	const [tenant] = await sql<{ id: string; name: string }[]>`
		select id, name from tenants where slug = ${tenantSlug} and deleted_at is null limit 1
	`;
	if (!tenant) throw new Error(`No tenant with slug "${tenantSlug}".`);

	const lodges = (await fetchAll(url)).filter((l) => l?.id && l?.name?.trim());
	if (!lodges.length) throw new Error('The source returned no lodges — refusing to run.');

	let created = 0;
	let updated = 0;
	for (const lodge of lodges) {
		const description = [humanise(lodge.accommodation_level), humanise(lodge.lodge_type)]
			.filter(Boolean)
			.join(' · ');

		// Keyed on the SOURCE id, so a renamed lodge updates rather than duplicating.
		const [existing] = await sql<{ id: string }[]>`
			select id from catalog_items
			where tenant_id = ${tenant.id} and external_source = 'lodges' and external_reference = ${lodge.id}
			limit 1
		`;
		if (existing) {
			await sql`
				update catalog_items
				set name = ${lodge.name.trim()}, description = ${description || null}, is_active = true, updated_at = now()
				where id = ${existing.id}
			`;
			updated++;
		} else {
			await sql`
				insert into catalog_items (tenant_id, type, name, description, external_reference, external_source)
				values (${tenant.id}, 'ACCOMMODATION', ${lodge.name.trim()}, ${description || null}, ${lodge.id}, 'lodges')
			`;
			created++;
		}
	}

	// Anything that has left the source is DEACTIVATED, never deleted: a trip that
	// already names a lodge must keep naming it after the lodge is retired.
	const ids = lodges.map((l) => l.id);
	const [{ retired }] = await sql<{ retired: number }[]>`
		update catalog_items set is_active = false, updated_at = now()
		where tenant_id = ${tenant.id} and external_source = 'lodges'
			and external_reference <> all(${ids}) and is_active = true
		returning 1 as retired
	`.then((rows) => [{ retired: rows.length }]);

	console.log(`${tenant.name}: ${created} added, ${updated} updated, ${retired} retired.`);
} catch (error) {
	console.error('Sync failed:', (error as Error).message);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
