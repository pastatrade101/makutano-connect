/**
 * Point an event at a newly approved template, and retire the one it replaces.
 *
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/whatsapp-promote-template.ts --tenant <id> --event QUOTATION_READY \
 *     --to quotation_ready_v2 [--apply]
 *
 * Dry run by default.
 *
 * WHY THIS IS NOT TWO UPDATE STATEMENTS. A WhatsApp template body is fixed at
 * approval, so changing a message means submitting a NEW template and moving the
 * event across once Meta approves. Doing that by hand goes wrong two ways, and
 * both are silent:
 *
 *   Leaving BOTH mapped. templateForEvent selects `where eventKey = ? and status
 *   = 'APPROVED' limit 1` with no ORDER BY, so which of the two a customer gets
 *   is whatever Postgres returns first — stable enough to look fine in testing
 *   and free to change under you.
 *
 *   Unmapping the OLD one first. templateForEvent falls back to the pack NAME for
 *   the event and writes the mapping back (template_mapping_healed), so the old
 *   template re-maps itself on the very next send. The new one must be mapped in
 *   the same breath, because the heal only runs when nothing is mapped.
 *
 * So: refuse unless the target is APPROVED, then map the new and unmap the old
 * in one transaction. The old row is left in place, disabled but not deleted —
 * Meta keeps it either way, and it is the thing to look at when someone asks why
 * the wording changed.
 */
import { and, eq, ne } from 'drizzle-orm';
import { db, schema, txDb } from '../src/lib/server/db';

const arg = (name: string): string | null => {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? null : (process.argv[i + 1] ?? null);
};
const APPLY = process.argv.includes('--apply');

async function main() {
	const tenantId = arg('tenant');
	const event = arg('event');
	const to = arg('to');
	if (!tenantId || !event || !to) throw new Error('--tenant, --event and --to are all required.');

	const rows = await db()
		.select()
		.from(schema.whatsappTemplates)
		.where(eq(schema.whatsappTemplates.tenantId, tenantId));

	const target = rows.find((r) => r.name === to);
	if (!target) throw new Error(`No template named ${to} for this tenant.`);
	if (target.status !== 'APPROVED') {
		console.log(`REFUSING: ${to} is ${target.status}, not APPROVED.`);
		console.log('Meta has not cleared it yet — promoting now would map an event to a template that cannot send.');
		process.exit(1);
	}

	const current = rows.filter((r) => r.eventKey === event && r.name !== to);
	console.log(`${APPLY ? 'PROMOTING' : 'DRY RUN'}  ${event}`);
	console.log(`  to      : ${target.name} [${target.status}]  vars ${JSON.stringify(target.variables)}`);
	for (const c of current) console.log(`  retiring: ${c.name} [${c.status}]  vars ${JSON.stringify(c.variables)}`);
	if (!current.length) console.log('  (nothing currently mapped to this event)');

	if (!APPLY) {
		console.log('\nDry run. Re-run with --apply.');
		return;
	}

	await txDb().transaction(async (tx) => {
		// New one FIRST, in the same transaction: between an unmap and a map there
		// is a window where nothing is mapped, and a send landing in it heals the
		// old mapping straight back.
		await tx
			.update(schema.whatsappTemplates)
			.set({
				eventKey: event as typeof schema.whatsappTemplates.$inferSelect.eventKey,
				enabled: true,
				updatedAt: new Date()
			})
			.where(and(eq(schema.whatsappTemplates.tenantId, tenantId), eq(schema.whatsappTemplates.id, target.id)));
		await tx
			.update(schema.whatsappTemplates)
			.set({ eventKey: null, enabled: false, updatedAt: new Date() })
			.where(
				and(
					eq(schema.whatsappTemplates.tenantId, tenantId),
					eq(schema.whatsappTemplates.eventKey, event),
					ne(schema.whatsappTemplates.id, target.id)
				)
			);
	});
	console.log('\n  done.');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
