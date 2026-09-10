/**
 * What the marketplace DOES with a day, expressed as advice the composer can give.
 *
 * The composer has always been a content form: it collects a day's words and says
 * nothing about the page they land on. But the public itinerary is a layout with
 * real requirements, and two of them are invisible from inside a text box:
 *
 *   - The day photograph is a LAYOUT SWITCH. TourItinerary renders a day in two
 *     columns when it has one and a single column when it does not, so a tour
 *     where some days have a picture and some do not prints as two different
 *     designs stacked on each other.
 *   - Length is a layout input. Beside a 4:3 photograph in the narrower column,
 *     a short paragraph leaves the picture hanging past the words, and a very
 *     long one shrinks the picture to a tile beside a wall of text.
 *
 * The numbers below are bands, not limits, and they are read off the live
 * catalogue rather than chosen: 108 published days have a median title of 44
 * characters and a median description of 454. The bands ratify what the better
 * days already do instead of imposing a house style — nothing here blocks a
 * save, and nothing here writes an operator's words for them.
 *
 * Kept deliberately coarse. The real geometry lives in a private theme repo that
 * this repo cannot import and does not control, so precise arithmetic here would
 * be a second implementation that silently stops being true. A band survives a
 * few pixels of theme change; "72 characters" would not.
 */

/** Past this the day's heading wraps to a second line in the public accordion. */
export const TITLE_ONE_LINE = 55;

/** Beside a photograph, prose shorter than this leaves the picture hanging past it. */
export const DESC_PAIRS_WITH_PHOTO = 350;

/** Past this the photograph is a tile beside a wall of text — and it is a long read either way. */
export const DESC_LONG = 700;

/** Rich text in, visible characters out. Cheap on purpose: this runs per keystroke. */
export function plainLength(html: string | null | undefined): number {
	if (!html) return 0;
	return html
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&[a-z]+;/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim().length;
}

/**
 * What to say about a day's title, or null while it is in band.
 *
 * Silent by default. A counter that always shows a number is noise the eye
 * learns to skip, so these speak only where the rendered page actually changes,
 * and each one names the change rather than scolding.
 */
export function titleAdvice(title: string): string | null {
	const n = title.trim().length;
	if (n > TITLE_ONE_LINE) return 'Long enough to wrap onto a second line in the day header.';
	return null;
}

/** The same, for the day's prose — and it depends on whether the day has a picture. */
export function descriptionAdvice(html: string, hasPhoto: boolean): string | null {
	const n = plainLength(html);
	if (n === 0) return null;
	if (n > DESC_LONG) {
		return hasPhoto
			? 'Longer than the photograph beside it, so the picture will read as a small tile.'
			: 'A long read for one day. Travellers skim the itinerary before they read it.';
	}
	if (hasPhoto && n < DESC_PAIRS_WITH_PHOTO) {
		return 'Shorter than the photograph beside it, so the day will end in a gap.';
	}
	return null;
}

/**
 * How the days will print AS A SET — which is where raggedness actually comes
 * from. A day is rarely wrong on its own; the page looks uneven when the days
 * disagree with each other.
 */
export function photoEvenness(withPhoto: number, total: number): { even: boolean; message: string } {
	if (total === 0) return { even: true, message: '' };
	if (withPhoto === 0) {
		return { even: true, message: 'No day has a photograph, so every day prints the same way — one column of text.' };
	}
	if (withPhoto === total) {
		return { even: true, message: 'Every day has a photograph, so every day prints the same way — picture beside text.' };
	}
	const without = total - withPhoto;
	return {
		even: false,
		message: `${withPhoto} of ${total} days have a photograph. Days with one print as a picture beside text and the other ${without === 1 ? 'day prints' : `${without} print`} as a single column, so the page changes shape as a traveller scrolls.`
	};
}
