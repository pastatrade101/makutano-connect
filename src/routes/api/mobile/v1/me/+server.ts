// Who am I, what may I do, and what is waiting — the app's first call after launch.
import type { RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { attentionFor, continueWorking, myWork } from '$lib/server/attention';
import { db, schema } from '$lib/server/db';
import { env } from '$lib/server/env';
import { normalizeWorkspace } from '$lib/workspace';
import { ok, problem, requireViewer } from '$lib/server/mobile';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const workspace = normalizeWorkspace((event.locals.tenant?.settings as Record<string, unknown>)?.capabilities);
		const operatorLogo = alias(schema.media, 'me_operator_logo');
		const [attention, work, continuing, operatorRows] = await Promise.all([
			attentionFor(viewer.tenantId, viewer, workspace),
			myWork(viewer.tenantId, viewer),
			continueWorking(viewer.tenantId, viewer, workspace),
			/*
			 * Who this tenant is ON THE MARKETPLACE.
			 *
			 * The tenant name is the account; the operator profile is the shopfront
			 * a traveller sees, and they are not always the same words. A phone
			 * built around a marketplace should show the second one.
			 */
			db()
				.select({
					name: schema.operatorProfiles.displayName,
					slug: schema.operatorProfiles.slug,
					location: schema.operatorProfiles.location,
					verified: schema.operatorProfiles.isVerified,
					logoUrl: operatorLogo.url
				})
				.from(schema.operatorProfiles)
				.leftJoin(operatorLogo, eq(operatorLogo.id, schema.operatorProfiles.logoMediaId))
				.where(eq(schema.operatorProfiles.tenantId, viewer.tenantId))
				.limit(1)
		]);
		const operator = operatorRows[0] ?? null;
		const marketplace = env().MARKETPLACE_URL.replace(/\/+$/, '');
		return ok({
			user: { id: event.locals.user!.id, name: event.locals.user!.fullName, email: event.locals.user!.email },
			tenant: {
				id: event.locals.tenant!.id,
				name: event.locals.tenant!.name,
				workspace,
				currency: event.locals.tenant!.currency
			},
			// Null for a tenant with no marketplace presence yet — the phone then
			// falls back to the account name rather than inventing a shopfront.
			operator: operator
				? {
						name: operator.name,
						slug: operator.slug,
						location: operator.location,
						verified: operator.verified,
						logoUrl: operator.logoUrl,
						publicUrl: `${marketplace}/operators/${operator.slug}`
					}
				: null,
			marketplaceUrl: marketplace,
			role: event.locals.role,
			permissions: viewer.permissions,
			persona: attention.persona,
			attention: attention.items,
			context: attention.context,
			today: attention.today,
			myWork: work,
			continueWorking: continuing
		});
	} catch (err) {
		return problem(err, event.locals.requestId);
	}
};
