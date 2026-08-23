// Public widget configuration — safe subset only, served to any origin so the
// embeddable widget can render. Unknown/disabled ids 404 identically.
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { errorResponse, toAppError } from '$lib/server/errors';
import { publicFormConfig } from '$lib/server/forms';
import { enforce } from '$lib/server/rate-limit';
import { sha256 } from '$lib/server/encryption';

export const GET: RequestHandler = async (event) => {
	try {
		const ip = ipHashOf(event.getClientAddress());
		await enforce(`widget-cfg:${ip}`, 60, 60);
		const config = await publicFormConfig(event.params.publicId ?? '');
		return json(
			{ success: true, data: config },
			{ headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } }
		);
	} catch (err) {
		const res = errorResponse(toAppError(err));
		res.headers.set('access-control-allow-origin', '*');
		return res;
	}
};

function ipHashOf(address: string): string {
	try {
		return sha256(address).slice(0, 24);
	} catch {
		return 'unknown';
	}
}
