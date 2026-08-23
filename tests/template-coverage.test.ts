// Template coverage audit: for every live tenant, is each lifecycle event that the
// tenant's workspace actually uses backed by a template that will really fire —
// eventKey mapped, APPROVED by Meta, and enabled? Reports gaps; fails only if a
// template exists but is silently mis-wired (mapped + approved yet disabled).
import { describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

/** Which lifecycle events matter to which workspace — mirrors src/lib/workspace.ts. */
const EVENTS_BY_MODULE: Record<string, string[]> = {
	enquiries: ['BOOKING_REQUEST_RECEIVED'],
	bookings: ['BOOKING_CONFIRMED', 'TRIP_REMINDER'],
	quotations: ['QUOTATION_READY'],
	orders: ['ORDER_RECEIVED', 'ORDER_CONFIRMED', 'ORDER_READY', 'ORDER_DISPATCHED', 'ORDER_DELIVERED'],
	always: ['PAYMENT_RECEIVED', 'PAYMENT_REMINDER']
};

suite('WhatsApp template coverage', () => {
	it('audits every live tenant for missing or mis-wired lifecycle templates', async () => {
		const { db, schema, closeDb } = await import('../src/lib/server/db');
		const { eq } = await import('drizzle-orm');
		const { moduleRelevant, normalizeWorkspace } = await import('../src/lib/workspace');

		const tenants = await db().select().from(schema.tenants).where(eq(schema.tenants.status, 'ACTIVE'));

		// Pull fresh approval statuses from Meta first, so "LIVE" means live at Meta
		// today — not whenever someone last opened the Template Center.
		const { syncTemplates } = await import('../src/lib/server/whatsapp/templates');
		for (const tenant of tenants) {
			try {
				const n = await syncTemplates(tenant.id);
				console.log(`synced ${tenant.slug}: ${n} template(s) from Meta`);
			} catch (err) {
				console.log(`sync skipped for ${tenant.slug}: ${(err as Error).message}`);
			}
		}

		const misWired: string[] = [];
		const report: string[] = [];

		for (const tenant of tenants) {
			const ws = normalizeWorkspace((tenant.settings as Record<string, unknown>)?.capabilities);
			const connected = await db()
				.select({ id: schema.whatsappConnections.id })
				.from(schema.whatsappConnections)
				.where(eq(schema.whatsappConnections.tenantId, tenant.id));
			const templates = await db()
				.select()
				.from(schema.whatsappTemplates)
				.where(eq(schema.whatsappTemplates.tenantId, tenant.id));

			const relevantEvents = [
				...EVENTS_BY_MODULE.always,
				...(moduleRelevant(ws, 'enquiries') ? EVENTS_BY_MODULE.enquiries : []),
				...(moduleRelevant(ws, 'bookings') ? EVENTS_BY_MODULE.bookings : []),
				...(moduleRelevant(ws, 'quotations') ? EVENTS_BY_MODULE.quotations : []),
				...(moduleRelevant(ws, 'orders') ? EVENTS_BY_MODULE.orders : [])
			];

			report.push(`\n${tenant.slug} [workspace=${ws}, whatsapp=${connected.length ? 'connected' : 'NOT CONNECTED'}, templates=${templates.length}]`);
			for (const event of relevantEvents) {
				const mapped = templates.filter((t) => t.eventKey === event);
				const live = mapped.find((t) => t.status === 'APPROVED' && t.enabled);
				if (live) {
					report.push(`  LIVE     ${event} → "${live.name}" (${live.language})`);
				} else if (mapped.length) {
					const t = mapped[0];
					const why = t.status !== 'APPROVED' ? `status=${t.status}` : 'disabled';
					report.push(`  BLOCKED  ${event} → "${t.name}" exists but will NOT send (${why})`);
					if (t.status === 'APPROVED' && !t.enabled) misWired.push(`${tenant.slug}:${event}`);
				} else {
					// Also catch an approved Meta template that was synced but never mapped.
					const nameGuess = templates.find(
						(t) => t.status === 'APPROVED' && t.name.toLowerCase() === event.toLowerCase()
					);
					report.push(
						nameGuess
							? `  UNMAPPED ${event} — approved template "${nameGuess.name}" exists but has no event mapping`
							: `  MISSING  ${event} — no template; customers get no ${event.toLowerCase().replace(/_/g, ' ')} message`
					);
				}
			}
		}

		console.log(report.join('\n'));
		await closeDb();
		// Approved + mapped + disabled is the one state that is always a mistake.
		expect(misWired, `approved templates that are switched off: ${misWired.join(', ')}`).toEqual([]);
	}, 120_000);
});
