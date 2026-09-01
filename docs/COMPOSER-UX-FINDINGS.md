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

**X2 · The alt-text box collapses to 26 pixels between tablet and laptop.**
The upload row is `flex flex-wrap items-end gap-2`. The file input keeps its
intrinsic width (353px measured), the Upload button and the status line take
theirs, and the alt-text label is `min-w-0 flex-1` — so instead of wrapping onto
a second line it absorbs the entire shortfall. Measured at a 754px viewport:
the input is **26px wide**, its label 9px wide and 162px tall, one word per line.
An operator physically cannot type a description there.

It is the alt-text field specifically, which makes it worse than a cosmetic
break: alt text is what a screen reader announces and what a search engine
reads, and this is the only place the operator can write it.

Fix: give that label a real flex basis so `flex-wrap` can do its job —
`min-w-[16rem] flex-1` in place of `min-w-0 flex-1`. `min-w-0` is what tells the
browser it may shrink to nothing.
Seen at `src/routes/app/tours/[id]/+page.svelte:1341`.

**X3 · `GET /logout` returns 500.**
`src/routes/logout/+page.server.ts` declares `actions` and no `load`, and there
is no `+page.svelte`, so the route only answers POST. Anything that arrives by
GET — a typed URL, a bookmark, a browser prefetch — gets a 500 error page rather
than being signed out or redirected. The working control is the "Sign out"
button in the account sheet, which POSTs; the URL is simply a trap.

Fix: add a `load` that redirects to `/login` (or to `/app` for a signed-in user),
so a GET is a harmless redirect instead of a server error.

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
- Uploading six photographs set the gallery order from the submitted order and
  promoted the first to main, and the Media step went green immediately.
- The gallery cards show the alt text under each photo, so a missing or lazy
  description is visible rather than buried in an attribute.

---

## Fixed in this pass

Everything below was found by walking the chain as an operator and then as the
platform team, and is fixed in code rather than only written down.

**The marketplace 500ed the moment a tour was published.** `TourCard.svelte`
read `tour.destinations.map(...)`; the Connect projection never returned
`destinations`, `category` or `styles`, because the two `TourCard` types are
hand-maintained copies in two repos and had drifted. Nothing caught it: with
zero published tours, the card had never once rendered. Connect now hydrates the
three relations in two batched queries (`hydrateTourCards`), and the component
treats a missing list as empty so the next drift degrades instead of 500ing.

**Currency and group type were free text.** `currency` was checked against
`/^[A-Z]{3}$/`, so "ABC" was a currency the marketplace would format money with;
`group_type` was checked against nothing while the marketplace built its group
filter from `distinct(group_type)` — one filter option per spelling. Both are
closed lists now (`src/lib/tour-options.ts`), enforced in the service and by
CHECK constraints in `0039_tour_enums.sql`, which also maps the existing wording
rather than discarding it. Both render as selects.

**Save and continue.** "Next: Pricing" moved between steps without saving, so
the flow relied on a warning strip explaining that a reload would lose the work.
When a step has unsaved changes the button now saves first and advances only on
success — a failed save leaves the operator on the step, reading the error.

**X2 — alt-text box collapsed to 26px** between tablet and laptop. The upload
row is a two-column grid now, so nothing is squeezed to a sliver.

**B1 — one photo at a time.** The picker takes several at once and uploads them
in the order chosen. The shared description switches itself off for a multi-file
pick, because one sentence cannot honestly describe six photographs.

**F1 — "Start your first listing" appeared to do nothing.** The button is at the
bottom of the empty table; the form it opens renders at the top of the page.
Opening it now focuses the title field, which scrolls it into view.

**F2 — 104 undifferentiated destinations.** Grouped under headings by kind, with
a filter box, and the 31 administrative REGION rows sorted last and labelled
"usually not what you want".

**X3 — `GET /logout` returned 500.** It answers with a redirect; signing out
stays a POST, because a GET that destroys a session can be fired by any image
tag on any page.

**Onboarding never mentioned listing a tour.** The marketplace's call to action
is "List your tours", and the dashboard checklist talked about WhatsApp,
payments, colleagues and integrations. It now has "List your first tour",
second, ticked only by a listing actually sent for review.

**Admin review — collapsed label spacing.** "Stay:Tulia Boutique Hotel",
"just nowby Platform Admin". A trailing space at the end of an inline box
followed by another inline box is collapsed away; the gap is margin now.
