// Public API documentation. Authored as Markdown in src/lib/docs, rendered server-side
// with anchored headings and a generated table of contents. Content only — the page
// carries no secrets and needs no session.
import { marked, type Tokens } from 'marked';
import gettingStarted from '$lib/docs/01-getting-started.md?raw';
import bookingLifecycle from '$lib/docs/02-booking-lifecycle.md?raw';
import whatsapp from '$lib/docs/03-whatsapp.md?raw';
import whatsappTemplates from '$lib/docs/06-whatsapp-templates.md?raw';
import webhooks from '$lib/docs/04-webhooks-portal-errors.md?raw';
import commerce from '$lib/docs/05-orders-forms.md?raw';
import type { PageServerLoad } from './$types';

const SOURCE = [gettingStarted, bookingLifecycle, commerce, whatsapp, whatsappTemplates, webhooks].join('\n\n');

const slugify = (text: string) =>
	text
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');

type TocEntry = { id: string; text: string; depth: number };

let cached: { html: string; toc: TocEntry[] } | null = null;

function render(): { html: string; toc: TocEntry[] } {
	if (cached) return cached;
	const toc: TocEntry[] = [];
	const renderer = new marked.Renderer();
	renderer.heading = ({ tokens, depth }: Tokens.Heading) => {
		const text = tokens.map((t) => ('text' in t ? (t as { text: string }).text : '')).join('');
		const id = slugify(text);
		if (depth === 2) toc.push({ id, text, depth });
		return `<h${depth} id="${id}">${text}</h${depth}>`;
	};
	const html = marked.parse(SOURCE, { renderer, gfm: true }) as string;
	cached = { html, toc };
	return cached;
}

export const load: PageServerLoad = async ({ locals }) => {
	const { html, toc } = render();
	return { html, toc, signedIn: !!locals.user };
};
