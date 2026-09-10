// Two faults that between them left twelve templates reading "Pending" for weeks on a
// live account, with every button reporting success.
//
// The account had connected fine. Meta had created the WABA and auto-provisioned its
// own test number — the only number on a brand-new WABA — and we stored what Meta gave
// us. The templates, though, were local pack rows an older sync had inserted with no
// metaTemplateId and an unrecognised status mapped to PENDING. That row shape had no
// exit in any direction:
//
//   - the sync prune skips it        (`r.metaTemplateId && ...` — null is never stale)
//   - no webhook can fire for it     (Meta never received the template)
//   - the pack skips it by name      (`existingNames.has(item.name)`)
//   - and submit refused it outright (status had to be DRAFT or REJECTED)
//
// Four closed doors, and the screen said "Pending", which reads as "Meta is reviewing
// this". It wasn't. Nothing was in flight anywhere.
import { describe, expect, it } from 'vitest';
import { canSubmitToMeta } from '../src/lib/server/whatsapp/template-engine';
import { preferRealNumber } from '../src/lib/server/whatsapp/embedded-signup';

describe('a template that never reached Meta can still be sent there', () => {
	it('allows the obvious two', () => {
		expect(canSubmitToMeta({ status: 'DRAFT', metaTemplateId: null })).toBe(true);
		expect(canSubmitToMeta({ status: 'REJECTED', metaTemplateId: 'x' })).toBe(true);
	});

	it('allows a PENDING row that has no Meta id — the stranded shape', () => {
		// The guard is about what is AT META, not about the word in our column.
		expect(canSubmitToMeta({ status: 'PENDING', metaTemplateId: null })).toBe(true);
	});

	it('still refuses a PENDING row that IS at Meta, which is a real review in flight', () => {
		expect(canSubmitToMeta({ status: 'PENDING', metaTemplateId: '123' })).toBe(false);
	});

	it('still refuses an approved or paused template', () => {
		expect(canSubmitToMeta({ status: 'APPROVED', metaTemplateId: '123' })).toBe(false);
		expect(canSubmitToMeta({ status: 'PAUSED', metaTemplateId: '123' })).toBe(false);
		// Approved with no id is not a thing we create, but resubmitting it would
		// duplicate a live template, so the narrow exception must not widen.
		expect(canSubmitToMeta({ status: 'APPROVED', metaTemplateId: null })).toBe(false);
	});
});

describe('reconnect picks the number the business actually uses', () => {
	const test1 = { display_phone_number: '+1 555-487-0943', code_verification_status: 'NOT_VERIFIED' };
	const real = { display_phone_number: '+255 752 093 014', code_verification_status: 'VERIFIED' };
	const realUnverified = { display_phone_number: '+255 754 000 111', code_verification_status: 'NOT_VERIFIED' };

	it('changes nothing when there is only one number', () => {
		// A brand-new WABA has exactly the auto-provisioned number and nothing else.
		// Day one must behave exactly as it did before.
		expect(preferRealNumber([test1])).toBe(test1);
		expect(preferRealNumber([])).toBeUndefined();
	});

	it('prefers the verified real number over the auto-provisioned one', () => {
		// This is the whole point: Meta lists the test number first because it is
		// older, and `data[0]` therefore re-selected it every reconnect.
		expect(preferRealNumber([test1, real])).toBe(real);
	});

	it('prefers an unverified real number over the test range', () => {
		expect(preferRealNumber([test1, realUnverified])).toBe(realUnverified);
	});

	it('treats verification as the fact and the prefix as only a tie-breaker', () => {
		// A verified number wins even if it somehow sits in the test range, because
		// verification is a statement from Meta and the prefix is a guess.
		const verifiedTestRange = { display_phone_number: '+1 555-000-0000', code_verification_status: 'VERIFIED' };
		expect(preferRealNumber([realUnverified, verifiedTestRange])).toBe(verifiedTestRange);
	});

	it('keeps Meta ordering when nothing distinguishes the numbers', () => {
		const a = { display_phone_number: '+255 700 000 001' };
		const b = { display_phone_number: '+255 700 000 002' };
		expect(preferRealNumber([a, b])).toBe(a);
	});
});
