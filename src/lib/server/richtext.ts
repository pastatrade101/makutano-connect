// Operator-authored rich text, made safe to put on a public page (§9, §34).
//
// The columns these guard — tours.description, the four summaries, and each
// itinerary day's description — already hold HTML: the accommodations schema
// says so in as many words ("Rich text (HTML) from the source system, like tour
// descriptions"), and the marketplace already renders stay copy with {@html}.
// What was missing was anything that made that HTML safe, anywhere: not on the
// way in, not on the way out, not in the renderer. That was tolerable only
// because the existing rows came from our own import. The moment an operator can
// type into these fields it stops being tolerable, because every tenant would be
// one <script> away from a public page on somebody else's listing.
//
// So sanitisation happens in TWO places, deliberately:
//
//   on write  — so a payload never reaches the database and cannot be served by
//               some future code path that forgets to clean it;
//   on serve  — because rows written before this existed were never cleaned, and
//               because the marketplace is a separate application reached over
//               HTTP. Serve-time is the load-bearing one: it is what makes the
//               public API safe no matter what is in the table.
//
// The marketplace therefore needs no sanitiser of its own and no new dependency;
// what the API hands it is already clean.
import sanitizeHtml from 'sanitize-html';

/**
 * What an operator may express.
 *
 * Deliberately small, and it is the same list the composer's toolbar can
 * produce. The point is not to be generous — it is that the page has a
 * purchased theme with settled typography, and every tag here has to look
 * right inside .mk-prose. No h1/h2 (the page owns those, and a second h1
 * confuses the very SEO this exists to serve), no images (media is a first
 * class field with its own pipeline), no tables, no iframes, no styles.
 */
const ALLOWED_TAGS = [
	'p', 'br',
	'strong', 'b', 'em', 'i',
	'ul', 'ol', 'li',
	'h3', 'h4',
	'blockquote',
	'a'
] as const;

/*
 * Everything else is dropped.
 *
 * rel and target are listed NOT because an author may write them — transformTags
 * below rebuilds the attribute object from scratch, so anything they typed is
 * discarded — but because this filter runs AFTER that transform. Leaving them out
 * silently deleted the very rel="noopener" being added, which is a hardening step
 * that fails open and looks like it works.
 */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = { a: ['href', 'rel', 'target'] };

const OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: [...ALLOWED_TAGS],
	allowedAttributes: ALLOWED_ATTRIBUTES,
	// http/https/mailto only. This is what refuses javascript: and data: hrefs,
	// which is the whole reason an <a> is the one tag carrying an attribute.
	allowedSchemes: ['http', 'https', 'mailto'],
	allowedSchemesAppliedToAttributes: ['href'],
	// A relative href — /tours/some-slug — is how an internal link is expressed,
	// and it has no scheme at all, so it must be allowed explicitly.
	allowProtocolRelative: false,
	// Drop the CONTENTS of these too. Without this, sanitize-html removes the
	// <script> tag but keeps the code between them as text, which then renders as
	// visible garbage — and, worse, can be reassembled by a careless renderer.
	nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
	transformTags: {
		/*
		 * An external link opened in a new tab without rel="noopener" hands the
		 * opened page a handle on ours (window.opener) — reverse tabnabbing. An
		 * internal link is left exactly as authored, because those are the links
		 * this feature exists to create and they must stay ordinary crawlable
		 * hrefs with no rel noise diluting them.
		 */
		a: (_tagName, attribs) => {
			const href = String(attribs.href ?? '');
			const attributes: Record<string, string> = { href };
			if (!href.startsWith('/')) {
				attributes.rel = 'nofollow noopener noreferrer';
				attributes.target = '_blank';
			}
			return { tagName: 'a', attribs: attributes };
		}
	}
};

/** Clean a single rich text value. Null and empty stay null and empty. */
export function sanitizeRichText(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const cleaned = sanitizeHtml(value, OPTIONS).trim();
	// "<p></p>" is what an editor leaves behind when its content is deleted. It is
	// not empty by length and it is not nothing to a completeness check, so judge
	// it by what a reader would see rather than by the size of the markup.
	if (!cleaned.length || !richTextToPlain(cleaned)) return null;
	return cleaned;
}

/**
 * What the public page should render — which is not always what is stored.
 *
 * Every listing published before the composer had an editor holds PLAIN TEXT with
 * newlines, and the marketplace used to split it on blank lines into paragraphs.
 * Handing that same text to {@html} instead would collapse it into one run-on
 * block, because HTML does not care about newlines — a silent regression on every
 * page already earning search traffic, and the exact kind that looks like a CSS
 * problem rather than a data one.
 *
 * So: if the sanitised value carries no block markup, it came from before this
 * and is upgraded the way it always used to be rendered. Content with markup is
 * returned untouched. The test is for block tags specifically, so a legacy row
 * that happens to contain only <strong> still gets its paragraphs.
 */
export function renderRichText(value: string | null | undefined): string | null {
	const clean = sanitizeRichText(value);
	if (!clean) return null;
	if (/<(p|h3|h4|ul|ol|li|blockquote|br)\b/i.test(clean)) return clean;
	// Already sanitised, so any stray angle bracket is an entity by now and this
	// cannot introduce a tag that the allow-list refused.
	const blocks = clean
		.split(/\n{2,}/)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`);
	return blocks.length ? blocks.join('') : null;
}

/**
 * Plain text, for anywhere markup would be a bug rather than a feature.
 *
 * JSON-LD and <meta name="description"> are read by machines that will happily
 * index "<p>Six days in the" — structured data containing markup is corrupt
 * structured data. Entities are decoded so an apostrophe reads as an apostrophe
 * and not as &amp;#39;, and block boundaries become spaces so two paragraphs do
 * not fuse into one word.
 */
export function richTextToPlain(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const spaced = value.replace(/<\/(p|li|h3|h4|blockquote|ul|ol)>/gi, ' ').replace(/<br\s*\/?>/gi, ' ');
	const stripped = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
	const text = stripped
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
		.replace(/\s+/g, ' ')
		.trim();
	return text.length ? text : null;
}

/**
 * Is there anything here a person would read?
 *
 * The composer's completeness check asks "has this tour got a description?" and
 * a bare "<p></p>" — which is what an editor leaves behind when its content is
 * deleted — is not one. Length checks against the markup would also count the
 * tags, so a three-character description inside <blockquote> would pass a
 * twenty-character minimum.
 */
export function richTextLength(value: string | null | undefined): number {
	return (richTextToPlain(value) ?? '').length;
}
