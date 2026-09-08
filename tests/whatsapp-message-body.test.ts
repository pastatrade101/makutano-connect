// What the inbox shows for a template message.
//
// The bug this pins: the thread rendered "Hello {{customer.first_name}}, your
// quotation {{quotation.reference}} is ready" while the correctly resolved
// sentence — "Hello DEOGRATIUS, your quotation QT-2026-00002 is ready" — sat
// unused in the payload of the very same row.
//
// Two causes, both here. queueMessage asked renderTemplate for the body BEFORE
// looking at the preview it had already been handed; and renderTemplate only
// substituted positional {{1}} placeholders while whatsapp_templates stores the
// NAMED form, so it matched nothing and returned the template verbatim — which,
// being non-null, beat the correct text.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPreview } from '../src/lib/server/whatsapp/template-engine';

const MESSAGES = readFileSync('src/lib/server/whatsapp/messages.ts', 'utf8');

describe('renderPreview resolves what the customer actually read', () => {
	it('substitutes named placeholders', () => {
		expect(
			renderPreview(
				'Hello {{customer.first_name}}, quotation {{quotation.reference}} is ready — {{quotation.total}}.',
				['customer.first_name', 'quotation.reference', 'quotation.total'],
				['DEOGRATIUS', 'QT-2026-00002', 'USD 4360.00']
			)
		).toBe('Hello DEOGRATIUS, quotation QT-2026-00002 is ready — USD 4360.00.');
	});

	it('does not let a dot in a variable name act as a wildcard', () => {
		// "order.number" must not match "orderXnumber".
		expect(renderPreview('A {{orderXnumber}} B', ['order.number'], ['NOPE'])).toBe('A {{orderXnumber}} B');
	});
});

describe('the stored body is the rendered text', () => {
	const queue = MESSAGES.slice(MESSAGES.indexOf('export async function queueMessage'), MESSAGES.indexOf('payload: params.content'));

	it('takes the preview before falling back to reconstruction', () => {
		const preview = queue.indexOf('params.content.preview');
		const render = queue.indexOf('renderTemplate(');
		expect(preview).toBeGreaterThan(-1);
		expect(render).toBeGreaterThan(-1);
		// Order is the fix: reconstruction is the fallback, not the first choice.
		expect(preview).toBeLessThan(render);
	});

	it('reconstruction handles the NAMED form the table actually stores', () => {
		// toPositional() converts for Meta at submit time and is never written
		// back, so a positional-only substitution matches nothing.
		const render = MESSAGES.slice(MESSAGES.indexOf('async function renderTemplate'));
		expect(render).toContain('schema.whatsappTemplates.variables');
		expect(render).toMatch(/names\.forEach/);
	});
});
