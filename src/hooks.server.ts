// The single request pipeline (§23).
//
// Order matters: environment is validated once at boot; every request gets an id;
// /api/v1 authenticates by API key (tenant from the key, never the payload);
// /app and /admin authenticate by session cookie; webhooks bypass both because Meta
// authenticates with a signature instead. Security headers are applied to everything.
import { error, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { authenticateApiKey } from '$lib/server/api-keys';
import { permissionsForRole } from '$lib/server/auth/permissions';
import { resolveSession, SESSION_COOKIE } from '$lib/server/auth/session';
import { assertFeature, assertTenantActive, getLimit } from '$lib/server/entitlements';
import { sha256 } from '$lib/server/encryption';
import { assertEnv, isProduction } from '$lib/server/env';
import { errorResponse, toAppError } from '$lib/server/errors';
import { log } from '$lib/server/logger';
import { enforce } from '$lib/server/rate-limit';
import { resolveTenantForUser } from '$lib/server/tenants';
import { startWorker } from '$lib/server/jobs/worker';

// Fail fast on a misconfigured deployment (§30), then bring up the job worker (§28).
assertEnv();
startWorker();

function newRequestId(): string {
	return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export const handle: Handle = async ({ event, resolve }) => {
	const started = Date.now();
	event.locals.requestId = event.request.headers.get('x-request-id') ?? newRequestId();
	event.locals.session = null;
	event.locals.user = null;
	event.locals.tenant = null;
	event.locals.role = null;
	event.locals.permissions = [];
	event.locals.apiKey = null;
	event.locals.ipHash = null;

	try {
		event.locals.ipHash = sha256(event.getClientAddress()).slice(0, 32);
	} catch {
		// getClientAddress() throws behind some adapters during prerender; not fatal.
	}

	const path = event.url.pathname;
	const isExternalApi = path.startsWith('/api/v1');
	const isMetaWebhook = path.startsWith('/webhooks/');
	// The mobile app is a person, not a machine: it carries the SAME session a browser
	// would, over a bearer header instead of a cookie. Every visibility rule, permission
	// and tenant resolution below therefore applies to it unchanged — and a session
	// revoked in one place is revoked everywhere.
	const isMobileApi = path.startsWith('/api/mobile');

	if (isExternalApi) {
		try {
			const auth = await authenticateApiKey(event.request.headers.get('authorization'));
			event.locals.tenant = auth.tenant;
			event.locals.apiKey = {
				id: auth.apiKey.id,
				prefix: auth.apiKey.prefix,
				scopes: auth.scopes,
				environment: auth.apiKey.environment
			};
			// The API itself is an entitlement: a plan can switch it off entirely, and a
			// suspended tenant loses it immediately — both enforced here, before any route.
			await assertTenantActive(auth.tenant.id);
			await assertFeature(auth.tenant.id, 'api.enabled');
			// Per-tenant, per-plan limit — never one global bucket (§28).
			const limit = (await getLimit(auth.tenant.id, 'api.requestsPerMinute')) || 60;
			await enforce(`api:${auth.tenant.id}`, limit, 60);
		} catch (err) {
			const appError = toAppError(err);
			log.info('api_auth_rejected', { requestId: event.locals.requestId, path, code: appError.code });
			return withSecurityHeaders(errorResponse(appError, event.locals.requestId), event.url);
		}
	} else if (!isMetaWebhook) {
		const bearer = isMobileApi ? (event.request.headers.get('authorization') ?? '') : '';
		const token = bearer.toLowerCase().startsWith('bearer ')
			? bearer.slice(7).trim()
			: event.cookies.get(SESSION_COOKIE);
		const session = await resolveSession(token);
		if (session) {
			event.locals.session = session;
			event.locals.user = session.user;
			const ctx = await resolveTenantForUser(session.user, session.activeTenantId);
			if (ctx) {
				event.locals.tenant = ctx.tenant;
				event.locals.role = ctx.role;
				event.locals.permissions = ctx.permissions;
			} else if (session.user.isSuperAdmin) {
				event.locals.role = 'SUPER_ADMIN';
				event.locals.permissions = permissionsForRole('SUPER_ADMIN');
			}
		}
	}

	/*
	 * The super-admin gate, HERE and not only in src/routes/admin/+layout.server.ts.
	 *
	 * A layout `load` does not protect a form action. SvelteKit runs the action
	 * FIRST and only then loads data for the response — see the runtime's own
	 * comment, "for action requests, first call handler in +page.server.js"
	 * (@sveltejs/kit/src/runtime/server/page/index.js:75). So every POST to an
	 * ?/action under /admin was executing with no check on who sent it: any signed-in
	 * operator could suspend a tenant, publish a listing, hand out a verification
	 * badge, or — worst — call ?/openPortal, which writes another tenant's id into
	 * their own session and hands them that operator's entire account.
	 *
	 * A hook runs before routing, so it covers actions, loads, and anything added
	 * later. The layout check stays: defence in depth, and it is what produces the
	 * friendly 403 page for a normal visit.
	 */
	if (path === '/admin' || path.startsWith('/admin/')) {
		if (!event.locals.user) redirect(303, '/login');
		if (!event.locals.user.isSuperAdmin) error(403, 'This area is restricted.');
	}

	const response = await resolve(event, {
		// Meta's signature is computed over the exact bytes it sent, so the webhook
		// route must read the raw body itself; SvelteKit does not buffer it for us.
		filterSerializedResponseHeaders: (name) => name === 'content-type'
	});

	response.headers.set('x-request-id', event.locals.requestId);
	log.debug('request', {
		requestId: event.locals.requestId,
		method: event.request.method,
		path,
		status: response.status,
		ms: Date.now() - started
	});
	return withSecurityHeaders(response, event.url);
};

function withSecurityHeaders(response: Response, url: URL): Response {
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()');
	if (isProduction() && url.protocol === 'https:') {
		response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
	return response;
}

/** Never surface a stack trace or internal message to a client (§24, §29). */
export const handleError: HandleServerError = ({ error, event, status }) => {
	const appError = toAppError(error);
	if (status >= 500) {
		log.error('unhandled_error', {
			requestId: event.locals?.requestId,
			path: event.url.pathname,
			message: (error as Error)?.message,
			stack: isProduction() ? undefined : (error as Error)?.stack
		});
	}
	return {
		message: status >= 500 ? 'An unexpected error occurred.' : appError.message,
		code: appError.code,
		requestId: event.locals?.requestId
	};
};
