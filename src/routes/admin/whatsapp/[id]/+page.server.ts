import { error, fail, type Actions } from '@sveltejs/kit';
import { connectionHealth, disableConnection } from '$lib/server/admin/control-plane';
import { toAppError } from '$lib/server/errors';
import { parseUuid } from '$lib/server/http';
import { enqueue } from '$lib/server/jobs/queue';
import type { PageServerLoad } from './$types';

const idOf = (params: { id?: string }) => parseUuid(params.id ?? '', 'connection id');

export const load: PageServerLoad = async ({ params }) => {
	try {
		const health = await connectionHealth(idOf(params));
		// Deliberately reshaped: the raw row carries the encrypted token, which must
		// never reach a page payload even for a platform admin.
		const c = health.connection;
		return {
			tenant: { id: health.tenant.id, name: health.tenant.name, slug: health.tenant.slug, status: health.tenant.status },
			connection: {
				id: c.id,
				status: c.status,
				displayPhoneNumber: c.displayPhoneNumber,
				businessName: c.businessName,
				phoneNumberId: c.phoneNumberId,
				wabaId: c.wabaId,
				metaBusinessId: c.metaBusinessId,
				isPrimary: c.isPrimary,
				connectedAt: c.connectedAt,
				disconnectedAt: c.disconnectedAt,
				lastWebhookAt: c.lastWebhookAt,
				lastSuccessfulSendAt: c.lastSuccessfulSendAt,
				lastErrorAt: c.lastErrorAt,
				lastErrorCode: c.lastErrorCode,
				tokenExpiresAt: c.tokenExpiresAt,
				keyVersion: c.keyVersion,
				// Credential health without the credential: presence + shape only.
				credentialStored: Boolean(c.encryptedAccessToken && c.encryptedAccessToken.length > 8)
			},
			templates: health.templates,
			messages: health.messages
		};
	} catch {
		error(404, 'Connection not found');
	}
};

export const actions: Actions = {
	syncTemplates: async ({ locals, params }) => {
		const health = await connectionHealth(idOf(params));
		await enqueue('whatsapp.templates.sync', { tenantId: health.tenant.id }, { tenantId: health.tenant.id });
		return { success: true };
	},

	disable: async ({ locals, params, request }) => {
		const data = await request.formData();
		try {
			await disableConnection(idOf(params), { userId: locals.user!.id, requestId: locals.requestId }, String(data.get('reason') ?? '') || undefined);
			return { success: true };
		} catch (err) {
			return fail(400, { message: toAppError(err).message });
		}
	}
};
