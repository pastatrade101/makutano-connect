// A quotation, as the traveller sees it.
//
// The token IS the credential — there is no customer login in this product —
// so this route is deliberately narrow: one quotation, projected field by field,
// never cached at the edge, and never listable. A caller who does not already
// hold the link learns nothing, including whether a given token exists.
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '$lib/server/db';
import { AppError } from '$lib/server/errors';
import { handlePublic, preflight, publicJson } from '$lib/server/public-api';
import { markQuotationViewed } from '$lib/server/quotations';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = async () => preflight();

export const GET: RequestHandler = async (event) =>
	// Rate-limited harder than the listing feeds: a token is 40 hex characters,
	// and this is the one public route where guessing would be worth something.
	handlePublic(event, { scope: 'pub-quote', limit: 30 }, async () => {
		const token = event.params.token ?? '';
		if (!/^[a-f0-9]{20,80}$/.test(token)) throw new AppError('NOT_FOUND', 'That quote could not be found.');

		const operatorLogo = alias(schema.media, 'quote_operator_logo');
		const [row] = await db()
			.select({
				quotation: schema.quotations,
				customerFirstName: schema.customers.firstName,
				customerLastName: schema.customers.lastName,
				operatorName: schema.operatorProfiles.displayName,
				operatorSlug: schema.operatorProfiles.slug,
				operatorLocation: schema.operatorProfiles.location,
				operatorVerified: schema.operatorProfiles.isVerified,
				operatorLogo: operatorLogo.url,
				operatorPhone: schema.operatorProfiles.publicPhone,
				operatorEmail: schema.operatorProfiles.publicEmail,
				tourSlug: schema.tours.slug,
				tourTitle: schema.tours.title
			})
			.from(schema.quotations)
			.leftJoin(schema.customers, eq(schema.customers.id, schema.quotations.customerId))
			.leftJoin(schema.operatorProfiles, eq(schema.operatorProfiles.tenantId, schema.quotations.tenantId))
			.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
			.leftJoin(schema.bookingRequests, eq(schema.bookingRequests.id, schema.quotations.bookingRequestId))
			.leftJoin(schema.tours, eq(schema.tours.id, schema.bookingRequests.tourId))
			.where(and(eq(schema.quotations.publicToken, token), isNull(schema.quotations.deletedAt)))
			.limit(1);

		// A withdrawn quotation reads as missing rather than as "was here": the
		// operator pulling it back should not leave the customer a page arguing
		// about a price that no longer stands.
		if (!row || row.quotation.status === 'DRAFT') {
			throw new AppError('NOT_FOUND', 'That quote could not be found.');
		}

		const items = await db()
			.select()
			.from(schema.quotationItems)
			.where(eq(schema.quotationItems.quotationId, row.quotation.id))
			.orderBy(schema.quotationItems.sortOrder);

		// Opening the page is the read receipt the operator sees. Fire and forget:
		// a failed status write must not cost the customer their quote.
		if (row.quotation.status === 'SENT') {
			void markQuotationViewed(row.quotation.tenantId, row.quotation.id).catch(() => undefined);
		}

		const q = row.quotation;
		return publicJson(
			{
				reference: q.reference,
				status: q.status === 'SENT' ? 'VIEWED' : q.status,
				currency: q.currency,
				subtotal: q.subtotal,
				discount: q.discount,
				tax: q.tax,
				total: q.total,
				validUntil: q.validUntil,
				startDate: q.startDate,
				endDate: q.endDate,
				adults: q.adults,
				children: q.children,
				notes: q.notes,
				terms: q.terms,
				sentAt: q.sentAt,
				customerName: [row.customerFirstName, row.customerLastName].filter(Boolean).join(' ').trim() || null,
				operator: row.operatorName
					? {
							name: row.operatorName,
							slug: row.operatorSlug,
							location: row.operatorLocation,
							verified: row.operatorVerified,
							logoUrl: row.operatorLogo,
							phone: row.operatorPhone,
							email: row.operatorEmail
						}
					: null,
				tour: row.tourSlug ? { slug: row.tourSlug, title: row.tourTitle } : null,
				items: items.map((line) => ({
					title: line.title,
					description: line.description,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					total: line.total
				}))
			},
			// A price with an expiry must never be served from a cache.
			'no-store'
		);
	});
