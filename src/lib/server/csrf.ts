// Cross-site form POST protection (§23).
//
// SvelteKit does this itself, inside respond(), BEFORE any hook runs — which is
// exactly why it had to move here. Its rule forbids a form POST whose Origin is not
// ours, and treats a MISSING Origin as not ours:
//
//     request_origin !== url.origin && (!request_origin || !trusted.includes(request_origin))
//
// A browser always sends Origin on a cross-site form POST, so that is the right rule
// for every route a person can reach, and it is reproduced below unchanged. It is
// wrong for exactly one caller: Meta's deauthorize callback is server-to-server, so
// it carries no Origin at all while posting application/x-www-form-urlencoded. Kit
// refused it 403 before our handler ran — and because Meta neither reports nor
// retries a 403 usefully, the app would have looked like it was simply ignoring
// revocations. `trustedOrigins` cannot fix that: a null origin fails the `!origin`
// clause whatever the list says.
//
// The exempt route is NOT unprotected. It is authenticated by an HMAC over its body
// with the Meta app secret, which is strictly stronger than an Origin header an
// attacker's page controls. See signed-request.ts.

const FORM_CONTENT_TYPES = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	// SvelteKit's own BINARY_FORM_CONTENT_TYPE, kept in step with its list.
	'application/x-sveltekit-formdata'
]);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Routes whose authenticity is proved by a signature over the body rather than by
 * an Origin header. Add to this only for a caller that verifies a signature BEFORE
 * it acts — never merely because a request is being refused.
 */
export const SIGNATURE_AUTHENTICATED_ROUTES = new Set(['/webhooks/meta/deauthorize']);

export function isFormContentType(contentType: string | null): boolean {
	return FORM_CONTENT_TYPES.has((contentType ?? '').split(';', 1)[0].trim().toLowerCase());
}

export function isCrossSiteFormPost(input: {
	method: string;
	pathname: string;
	contentType: string | null;
	origin: string | null;
	appOrigin: string;
}): boolean {
	if (SIGNATURE_AUTHENTICATED_ROUTES.has(input.pathname)) return false;
	if (!MUTATING_METHODS.has(input.method.toUpperCase())) return false;
	if (!isFormContentType(input.contentType)) return false;
	return input.origin !== input.appOrigin;
}
