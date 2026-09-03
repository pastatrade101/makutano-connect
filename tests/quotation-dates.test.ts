// The traveller's travel dates must survive the whole funnel.
//
// They are asked for once, on a public form, by somebody who may never reply
// again. Losing them means an operator emailing a customer to ask a question the
// customer already answered — and in production it meant every trip built from a
// web quotation sat blocked on "Travel dates set" with a link to a page that
// could not set them.
//
// Measured before the fix: enquiries 12/19 had dates, bookings only 4/6.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const WEB = 'src/routes/app/booking-requests/[id]/+page.server.ts';
const MOBILE = 'src/routes/api/mobile/v1/quotations/+server.ts';
const ACCEPT = 'src/lib/server/quotations.ts';

describe('travel dates survive enquiry -> quotation -> booking', () => {
	it('the web conversion passes the dates to createQuotation', () => {
		const src = readFileSync(WEB, 'utf8');
		const call = src.slice(src.indexOf('await createQuotation('));
		const args = call.slice(0, call.indexOf('locals.user'));
		// The bug was an omission, so the assertion has to be about the CALL, not
		// about the file containing the words somewhere.
		expect(args).toContain('startDate');
		expect(args).toContain('endDate');
	});

	it('falls back to what the traveller asked for when the operator types nothing', () => {
		const src = readFileSync(WEB, 'utf8');
		expect(src).toContain("draft.enquiry.startDate");
		expect(src).toContain("draft.enquiry.endDate");
	});

	it('the mobile conversion still passes them too', () => {
		const src = readFileSync(MOBILE, 'utf8');
		const call = src.slice(src.indexOf('await createQuotation('));
		expect(call.slice(0, 800)).toContain('startDate');
	});

	it('accepting a quotation copies the dates onto the booking', () => {
		const src = readFileSync(ACCEPT, 'utf8');
		const call = src.slice(src.indexOf('const booking = await createBooking('));
		const args = call.slice(0, call.indexOf('items:'));
		expect(args).toContain('startDate: quotation.startDate');
		expect(args).toContain('endDate: quotation.endDate');
	});

	it('the composer offers the fields, so a date change is possible without a dead end', () => {
		const src = readFileSync('src/routes/app/booking-requests/[id]/+page.svelte', 'utf8');
		expect(src).toContain('name="startDate"');
		expect(src).toContain('name="endDate"');
	});
});
