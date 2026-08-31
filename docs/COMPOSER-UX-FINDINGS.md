# Tour composer — findings from the first real end-to-end run

Recorded while creating the first genuine listing (Makutano Digital, 6-Day
Northern Circuit Safari). Blockers first, then friction, then what worked.

Status: OPEN unless marked.

---

## Bugs

**X1 · "Not saved yet: Basics" shown permanently, right after a successful save.**
FIXED during the run. setTourCategories writes the primary category into the
link set whether or not the browser sent it; the draft does not carry it (the
primary chip renders on-and-disabled rather than selected). So the dirty check
compared `[]` against `[safari]` and never reconciled. Every operator would have
been told their work was unsaved from their first save onward — which teaches
people to ignore the warning, and the warning is the only thing standing between
them and losing an itinerary on reload. Introduced with the category work earlier
today. Now compares the set as the SERVER will hold it.

---

## Blockers

**B1 · A gallery upload takes one file picker per photo.**
`<input type="file">` on the Media step has no `multiple`. A listing wants five
or six photographs, so that is five or six trips through the picker, each with a
full page round trip. Should accept a multi-select and a drop zone.

**B2 · No drag-and-drop onto the uploader.**
Operators arrive with a folder of images open. Dropping them is the expected
gesture; there is nowhere to drop.

---

## Friction

**F1 · "Start your first listing" opens the form somewhere else.**
The button sits at the bottom of the empty-state table; the form it opens is
rendered at the TOP of the page, above the filters. Nothing scrolls. I clicked
it and concluded it was broken — twice — before checking the DOM. If the button
is at the bottom, either scroll the form into view or open it in place.

**F2 · The destination picker lists all 104 places with no grouping.**
"Arusha", "Arusha National Park" and "Arusha Region" appear as three adjacent,
near-identical checkboxes. The 31 REGION rows are administrative geography that
a tour almost never "visits" — they exist for browsing. Either exclude REGION
from this picker, group it under a heading, or at minimum show the type beside
the name.

**F3 · Destinations are hidden until a country is chosen.**
Correct behaviour — the service refuses places before the listing knows its
country — but the step gives no hint that the empty area will fill in. A line
saying so would save a confused pause.

---

## What worked well

- The readiness panel ("2 of 10") tags every gap with the step that fixes it,
  and updates immediately on save. This is the best thing in the composer.
- Category and travel-style selection saved first time; the primary category
  auto-locks into the set and cannot be unticked, as intended.
- The draft redirected straight into the composer on create — no extra click.
- AVIF is accepted, which matters: the operator's whole library is AVIF.
