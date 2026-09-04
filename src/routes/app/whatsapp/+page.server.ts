// WhatsApp connection moved into Settings, where the rest of the set-up-once
// work lives. This route stays because four things still point at it — the
// onboarding checklist, the dashboard prompt, the sidebar history in people's
// muscle memory, and, most importantly, `redirectUrl` in the Meta Embedded
// Signup handler, which sends the operator back here after they authorise. A
// dead link there would strand somebody in the middle of connecting a number.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	redirect(308, '/app/settings/whatsapp');
};
