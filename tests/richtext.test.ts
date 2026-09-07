// The boundary between what an operator types and what a stranger's browser runs.
//
// These columns already held HTML before any of this — the accommodations schema
// says "Rich text (HTML) from the source system, like tour descriptions" — and
// the marketplace already rendered stay copy with {@html}, with no sanitiser
// anywhere in either repo. That was survivable only while the HTML came from our
// own import. Once operators can type into these fields, every tenant is one
// <script> away from a public page, so this file is the thing that must not
// regress.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderRichText, richTextLength, richTextToPlain, sanitizeRichText } from '../src/lib/server/richtext';

describe('script never survives', () => {
	it('drops a script tag AND its contents', () => {
		const out = sanitizeRichText('<p>Safari</p><script>alert(1)</script>');
		expect(out).toBe('<p>Safari</p>');
		expect(out).not.toContain('alert');
	});

	it('drops event handlers while keeping the element', () => {
		expect(sanitizeRichText('<p onclick="alert(1)">Day one</p>')).toBe('<p>Day one</p>');
		expect(sanitizeRichText('<p onmouseover=alert(1)>x</p>')).not.toContain('onmouseover');
	});

	it('refuses javascript: and data: hrefs', () => {
		for (const href of [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
			'vbscript:msgbox(1)'
		]) {
			const out = sanitizeRichText(`<a href="${href}">click</a>`) ?? '';
			expect(out).not.toContain('javascript');
			expect(out).not.toContain('data:text/html');
			expect(out).not.toContain('vbscript');
		}
	});

	it('drops svg, iframe, style and img entirely', () => {
		for (const payload of [
			'<svg onload=alert(1)></svg>',
			'<iframe src="https://evil.example"></iframe>',
			'<style>body{display:none}</style>',
			'<img src=x onerror=alert(1)>'
		]) {
			const out = sanitizeRichText(`<p>ok</p>${payload}`) ?? '';
			expect(out).toBe('<p>ok</p>');
		}
	});

	it('keeps no attribute other than href', () => {
		const out = sanitizeRichText('<p class="x" style="color:red" id="y" data-z="1">t</p>');
		expect(out).toBe('<p>t</p>');
	});
});

describe('what an operator may legitimately write survives', () => {
	it('keeps the toolbar’s own vocabulary', () => {
		const html = '<h3>Day 1</h3><p><strong>Serengeti</strong> and <em>Ngorongoro</em></p><ul><li>Game drive</li></ul>';
		expect(sanitizeRichText(html)).toBe(html);
	});

	it('keeps an internal tour link exactly as authored, with no rel noise', () => {
		// This is the SEO case: a plain crawlable href to another listing.
		const out = sanitizeRichText('<p>See <a href="/tours/serengeti-7-day">our Serengeti trip</a>.</p>');
		expect(out).toBe('<p>See <a href="/tours/serengeti-7-day">our Serengeti trip</a>.</p>');
		expect(out).not.toContain('nofollow');
		expect(out).not.toContain('target');
	});

	it('hardens an EXTERNAL link against tabnabbing', () => {
		const out = sanitizeRichText('<a href="https://example.com">x</a>') ?? '';
		expect(out).toContain('rel="nofollow noopener noreferrer"');
		expect(out).toContain('target="_blank"');
	});

	it('leaves plain text — what all 39 live listings hold today — untouched', () => {
		expect(sanitizeRichText('Six days across the northern circuit.')).toBe('Six days across the northern circuit.');
	});

	it('treats null, undefined and whitespace-only as nothing', () => {
		expect(sanitizeRichText(null)).toBeNull();
		expect(sanitizeRichText(undefined)).toBeNull();
		expect(sanitizeRichText('   ')).toBeNull();
		expect(sanitizeRichText('<p></p>')).toBeNull();
	});
});

describe('structured data never receives markup', () => {
	it('strips tags for JSON-LD and meta description', () => {
		expect(richTextToPlain('<h3>Day 1</h3><p>Serengeti <strong>plains</strong></p>')).toBe('Day 1 Serengeti plains');
	});

	it('does not fuse two blocks into one word', () => {
		expect(richTextToPlain('<p>one</p><p>two</p>')).toBe('one two');
		expect(richTextToPlain('<li>a</li><li>b</li>')).toBe('a b');
	});

	it('decodes entities so an apostrophe is an apostrophe', () => {
		expect(richTextToPlain('<p>Ngorongoro&#39;s rim &amp; crater</p>')).toBe("Ngorongoro's rim & crater");
	});

	it('measures what a reader sees, not the markup', () => {
		// A length check against the HTML would count the tags and let a
		// three-character description pass a twenty-character minimum.
		expect(richTextLength('<blockquote><p>abc</p></blockquote>')).toBe(3);
		expect(richTextLength('<p></p>')).toBe(0);
	});
});

describe('the 39 listings already published keep rendering', () => {
	// They hold plain text with newlines. The page used to split that into <p>;
	// handing it straight to {@html} would collapse it into one run-on block.
	it('turns legacy plain text into paragraphs, as the page always did', () => {
		expect(renderRichText('First para.\n\nSecond para.')).toBe('<p>First para.</p><p>Second para.</p>');
	});

	it('keeps a single newline as a line break rather than losing it', () => {
		expect(renderRichText('Line one\nLine two')).toBe('<p>Line one<br />Line two</p>');
	});

	it('leaves authored markup exactly alone', () => {
		const html = '<h3>Day 1</h3><p>Serengeti</p>';
		expect(renderRichText(html)).toBe(html);
	});

	it('still gives a legacy row paragraphs when it only contains inline markup', () => {
		expect(renderRichText('A <strong>big</strong> day.\n\nAnd another.')).toBe(
			'<p>A <strong>big</strong> day.</p><p>And another.</p>'
		);
	});

	it('cannot smuggle a tag through the paragraph upgrade', () => {
		// Sanitisation runs first, so by the time paragraphs are added there is
		// nothing left that could become an element.
		const out = renderRichText('before\n\n<script>alert(1)</script>\n\nafter') ?? '';
		expect(out).not.toContain('<script');
		expect(out).not.toContain('alert');
	});

	it('is nothing for nothing', () => {
		expect(renderRichText(null)).toBeNull();
		expect(renderRichText('   ')).toBeNull();
	});
});

/*
 * Two faults this file exists to keep out, both found on a live page.
 *
 * The first was visible: the four practical summaries were rendered to HTML at
 * the serve boundary while every slot that displays them takes a plain string,
 * so journeys.makutano.co.tz printed a literal "<p>All meals on safari.</p>"
 * under the Meals heading. Sanitising a field is only half the contract — the
 * other half is that its consumers are told which shape they are getting.
 *
 * The second was not visible, which is worse: the accommodation directory served
 * `description` and `whyWeRecommend` straight out of the table, and the stays
 * page renders both with {@html}.
 */
describe('the rendered/plain contract at the serve boundary', () => {
	const MARKETPLACE = readFileSync('src/lib/server/marketplace.ts', 'utf8');
	const ACCOMMODATIONS = readFileSync('src/lib/server/accommodations.ts', 'utf8');
	const SUMMARIES = ['accommodationSummary', 'transportSummary', 'mealsSummary', 'bestTimeSummary'];

	it('every rendered summary ships a plain twin beside it', () => {
		for (const field of SUMMARIES) {
			expect(MARKETPLACE).toContain(`${field}: renderRichText(row.tour.${field})`);
			expect(MARKETPLACE).toContain(`${field}Plain: richTextToPlain(row.tour.${field})`);
		}
	});

	it('the description keeps the same pairing it always had', () => {
		expect(MARKETPLACE).toContain('description: renderRichText(row.tour.description)');
		expect(MARKETPLACE).toContain('descriptionPlain: richTextToPlain(row.tour.description)');
	});

	it('nothing the stays page renders as HTML leaves the directory uncleaned', () => {
		expect(ACCOMMODATIONS).toContain('description: renderRichText(row.description)');
		expect(ACCOMMODATIONS).toContain('whyWeRecommend: renderRichText(row.whyWeRecommend)');
		expect(ACCOMMODATIONS).not.toMatch(/\bdescription: row\.description\b/);
		expect(ACCOMMODATIONS).not.toMatch(/\bwhyWeRecommend: row\.whyWeRecommend\b/);
	});

	it('a plain twin is a string a text slot can hold, not markup', () => {
		// The property the consumers rely on: whatever the operator wrote, the
		// plain form carries no angle bracket for a text slot to print.
		const authored = '<h3>When to come</h3><p>June to <strong>October</strong>.</p><ul><li>Dry</li></ul>';
		const plain = richTextToPlain(authored) ?? '';
		expect(plain).not.toMatch(/[<>]/);
		expect(plain).toBe('When to come June to October. Dry');
	});

	it('a summary that is only an empty paragraph is nothing in both shapes', () => {
		expect(renderRichText('<p></p>')).toBeNull();
		expect(richTextToPlain('<p></p>')).toBeNull();
	});
});
