// Database-safe reference generation (§14). COUNT+1 races under concurrency and reuses
// numbers after deletes; instead each (tenant, kind, year) row is incremented inside a
// single atomic UPSERT that returns the new value, so two simultaneous requests can
// never receive the same reference.
import { sql } from 'drizzle-orm';
import type { Database } from './index';

export type ReferenceKind = 'RQ' | 'BK' | 'QT' | 'PY' | 'OR' | 'TR';

/**
 * Reserve the next reference for a tenant, e.g. EMN-RQ-2026-00001.
 * @param prefix the tenant's booking/quotation prefix (§26)
 */
export async function nextReference(
	database: Database,
	tenantId: string,
	kind: ReferenceKind,
	prefix: string,
	now: Date = new Date()
): Promise<string> {
	const year = now.getUTCFullYear();
	const rows = await database.execute<{ value: number }>(sql`
		insert into reference_counters (tenant_id, kind, year, value)
		values (${tenantId}::uuid, ${kind}, ${year}, 1)
		on conflict (tenant_id, kind, year)
		do update set value = reference_counters.value + 1
		returning value
	`);
	const value = Number((rows as unknown as Array<{ value: number }>)[0]?.value ?? 1);
	const clean =
		(prefix || 'MKT')
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '')
			.slice(0, 8) || 'MKT';
	return `${clean}-${kind}-${year}-${String(value).padStart(5, '0')}`;
}
