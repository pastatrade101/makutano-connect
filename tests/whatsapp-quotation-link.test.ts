/*
 * The quotation link has to reach WhatsApp, not just email.
 *
 * sendQuotation always passed `link` alongside the reference and total, and
 * `quotation.link` has always been a resolvable template variable — but the pack
 * body had no slot for it, so the value was handed over and discarded. The same
 * quotation reached one customer two ways: the email carried a link to the quote
 * page and the WhatsApp message said "reply here".
 *
 * It was a deliberate choice once — not every tenant had a public quote page, and
 * sendEventTemplate drops a message whose variables resolve empty, so a link-free
 * body always sent. deliverQuotation mints a token on every send now and
 * MARKETPLACE_URL has a default, so the link is never empty and the reason is gone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PACK = readFileSync('src/lib/server/whatsapp/template-packs.ts', 'utf8');
const ENGINE = readFileSync('src/lib/server/whatsapp/template-engine.ts', 'utf8');
const QUOTATIONS = readFileSync('src/lib/server/quotations.ts', 'utf8');

/** The pack entry for one template name, up to the next entry. */
const entry = (name: string) => {
	const start = PACK.indexOf(`name: '${name}'`);
	expect(start).toBeGreaterThan(-1);
	const next = PACK.indexOf('\t\tname: ', start + 10);
	return PACK.slice(start, next === -1 ? undefined : next);
};

describe('quotation_ready carries the quote link', () => {
	it('the body has a slot for the link', () => {
		expect(entry('quotation_ready')).toContain('{{quotation.link}}');
	});

	it('the sender still supplies one', () => {
		// Both halves have to hold: a slot with nothing to fill it renders empty,
		// and sendEventTemplate then skips the whole message. Sliced rather than
		// regexed across the object — the total is a template literal, so its own
		// closing brace ends any [^}]* the pattern tries to walk.
		const send = QUOTATIONS.slice(QUOTATIONS.indexOf("'QUOTATION_READY'"));
		const call = send.slice(0, send.indexOf('`quotation-QUOTATION_READY'));
		expect(call).toContain('link');
	});

	it('the link is a resolvable variable', () => {
		expect(ENGINE).toContain("'quotation.link'");
	});

	it('the body neither starts nor ends with a variable', () => {
		// Meta refuses those outright (2388299); submitTemplateToMeta refuses them
		// first so an operator gets a sentence rather than "Invalid parameter".
		const match = entry('quotation_ready').match(/bodyText:\s*\n?\s*'([^']+)'/);
		const body = (match?.[1] ?? '').trim();
		expect(body.length).toBeGreaterThan(0);
		expect(/^\{\{/.test(body)).toBe(false);
		expect(/\}\}[\s.,;:!?—-]*$/.test(body)).toBe(false);
	});

	it('review-time examples give the link a real URL, not the word "example"', () => {
		// submitTemplateToMeta falls back to 'example' for any variable the sample
		// context cannot resolve. A URL variable whose sample is not a URL is what
		// gets a template rejected, and a rejection costs days, not minutes.
		const samples = ENGINE.slice(
			ENGINE.indexOf('const examples = resolveVariables'),
			ENGINE.indexOf('const components')
		);
		expect(samples).toMatch(/link:\s*'https:\/\//);
	});
});

/*
 * Which template wins when two are mapped to one event.
 *
 * This is not hypothetical: a replacement has to be submitted and approved
 * before the old one can be retired, so both are mapped for the whole time Meta
 * spends reviewing. quotation_ready and quotation_ready_v2 sat in exactly that
 * state on the live tenant.
 */
describe('template selection is deterministic', () => {
	const TEMPLATES = readFileSync('src/lib/server/whatsapp/templates.ts', 'utf8');
	const selector = TEMPLATES.slice(
		TEMPLATES.indexOf('export async function templateForEvent'),
		TEMPLATES.indexOf('export async function listTemplates')
	);

	it('orders the candidates instead of taking whatever comes back first', () => {
		// limit(1) with no orderBy is a coin toss the planner is free to re-flip.
		expect(selector).toMatch(/\.orderBy\([^)]*createdAt[^)]*\)/);
		expect(selector.indexOf('.orderBy')).toBeLessThan(selector.indexOf('.limit(1)'));
	});

	it('orders by createdAt, which a sync cannot flatten', () => {
		// syncTemplates stamps updatedAt on every row it touches, so after a sync
		// the two rows are identical on that column and it carries no order.
		expect(selector).toContain('desc(schema.whatsappTemplates.createdAt)');
		expect(selector).not.toMatch(/orderBy\([^)]*updatedAt/);
	});

	it('still refuses anything Meta has not approved', () => {
		// A pending replacement must never be selected — it cannot send.
		expect(selector).toContain("eq(schema.whatsappTemplates.status, 'APPROVED')");
	});
});
