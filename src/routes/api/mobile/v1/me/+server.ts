// Who am I, what may I do, and what is waiting — the app's first call after launch.
import type { RequestHandler } from '@sveltejs/kit';
import { attentionFor, continueWorking, myWork } from '$lib/server/attention';
import { normalizeWorkspace } from '$lib/workspace';
import { ok, problem, requireViewer } from '$lib/server/mobile';

export const GET: RequestHandler = async (event) => {
	try {
		const viewer = requireViewer(event);
		const workspace = normalizeWorkspace((event.locals.tenant?.settings as Record<string, unknown>)?.capabilities);
		const [attention, work, continuing] = await Promise.all([
			attentionFor(viewer.tenantId, viewer, workspace),
			myWork(viewer.tenantId, viewer),
			continueWorking(viewer.tenantId, viewer, workspace)
		]);
		return ok({
			user: { id: event.locals.user!.id, name: event.locals.user!.fullName, email: event.locals.user!.email },
			tenant: {
				id: event.locals.tenant!.id,
				name: event.locals.tenant!.name,
				workspace,
				currency: event.locals.tenant!.currency
			},
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
