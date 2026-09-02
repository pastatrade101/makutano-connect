# What this product is for

Makutano is not trying to be SafariBookings or TourRadar. Reproducing everything
they have would slow the work down, and it would not win anything: a traveller
does not choose a marketplace because it lists more countries.

The aim is narrower and harder to copy. Become exceptionally good at one
journey — **Tanzania operator → traveller → quotation → booking** — and expand
from there.

## The thing that is not obvious from the marketplace

Looking only at the public pages, Makutano reads like a directory of tours. It
is not. There are two products and they meet in the middle:

> **Makutano Journeys brings the customer in.
> Makutano Connect operates the business after the enquiry.**

Which means the loop is far deeper than a listing site's:

```
Discover → Compare → Enquire → WhatsApp → Quote → Revise → Accept
        → Book → Pay → Travel → Review → Reputation
```

A marketplace giant can list thousands of tours. It cannot follow one of them
from a Google search through the operator's own WhatsApp number to a quotation,
a revision, a confirmed booking, a payment, a trip that actually happened, and a
review written by the person who took it.

**That loop is the foundation. Protect it.** Any feature that does not serve it,
or that makes a step in it slower or less trustworthy, is a feature for a
different company.

## The five things that close the gap

### 1. Discovery must feel world-class

A traveller arriving from Google should be able to explore Serengeti, Zanzibar,
Kilimanjaro and Ngorongoro immediately, filter by travel style and category,
compare tours and understand pricing. The destination → style → tour
architecture is already the right shape for this.

### 2. Tour pages must sell the experience

Photography, itinerary, route, accommodation, inclusions, operator identity,
verified reviews, pricing, and a Request Trip button that never scrolls out of
reach. This page is where somebody decides whether Makutano is trustworthy
enough for a $2,000–$10,000 purchase. Nothing on it should overstate, because at
that price a single unbelievable claim costs the whole page.

### 3. Operator trust must become a major asset

Reviews exist for exactly this reason. Automatic reputation badges make operator
quality visible without anyone hand-curating it. The marketplace should end up
communicating something a directory cannot:

> These are not random companies listed on a website. Makutano knows who
> operated the booking, and who actually travelled.

### 4. Compare should be excellent, and small

Two or three tours, and only the things that actually decide a safari: price per
person, duration, destinations, travel style, private or group, accommodation
level, itinerary highlights, inclusions, operator rating. Then Request This Trip.

Do not let Compare grow into a subsystem. Mobile comparison matters most, and a
comparison a phone cannot hold is a comparison nobody makes.

### 5. Connect is the differentiator

This is where to invest heavily over time. The operator receives the enquiry in
Connect or on their phone, continues on their own WhatsApp number, builds and
revises a quotation, turns acceptance into a booking, collects payment, runs the
trip, and asks for a verified review afterwards.

Listing tours is the part competitors can match. This is not.

## The system, long term

```
                        MAKUTANO
                  Tanzania Travel Layer

     DISCOVER                         TRUST
        │                               │
 Destinations                      Operators
 Categories                         Reviews
 Travel Styles                      Badges
 Tours                              Verification
 Compare                                │
        │                               │
        └───────────┬───────────────────┘
                    ↓
                 ENQUIRE
                    ↓
             MAKUTANO CONNECT
                    ↓
        ┌───────────┼────────────┐
        ↓           ↓            ↓
     Inbox       WhatsApp     Customer
        │
        ↓
    Quotation
        ↓
     Revision
        ↓
    Acceptance
        ↓
     Booking
        ↓
     Payment
        ↓
       Trip
        ↓
      Review
        ↓
   Reputation
        ↓
 Better marketplace ranking
        ↓
   More enquiries
```

The last four steps are the part worth reading twice. Reputation earned from
trips that demonstrably happened feeds marketplace ranking, ranking feeds
enquiries, and enquiries feed the operators who earned them. A directory cannot
run that circuit, because it never finds out whether the trip happened.

## What this rules out

Written down so it does not have to be re-argued:

- **Feature parity as a goal.** Match a competitor's feature only when this
  journey needs it.
- **Claims the software cannot enforce.** Verified means the booking completed.
  A rating means somebody travelled. If a badge cannot be derived from a record,
  it does not go on a page.
- **Breadth before depth.** More countries, more categories and more listings
  are worth less than one journey that works end to end.

## Where the loop actually stands

Counted against production on 2 September 2026. Every stage exists as a real
table with a real service behind it — what varies is how much of it has been
used, and that is the honest measure of which parts are finished.

| Stage | Built | In production |
|---|---|---|
| Discover — destinations, categories, styles | yes | 108 destinations, 39 tours, 55 stays |
| Compare | yes | 2–4 tours, shortlist held in the browser |
| Enquire | yes | 18 booking requests |
| WhatsApp | yes | 12 conversations, per-tenant numbers |
| Quotation | yes | 24 quotations, public link on the marketplace |
| Revision → Acceptance | yes | accepting one confirms its booking |
| Booking | yes | 5 bookings |
| Payment | yes | 3 payments |
| Trip | yes | **0** — built, never used |
| Review | yes | **0** — built, never used |
| Reputation | no | — |
| Ranking from reputation | **no** | see below |

Two things follow from that table.

**Trips and Reviews are the untested end of the loop.** Both are complete and
deployed, and neither has carried a real record. Until one does, the closing
steps of the journey are a design, not a fact — and the eleven Postgres
integration tests behind Reviews have never run against a database either.

**Nothing ranks by reputation yet.** `recommended` is an editorial order the
platform controls — featured first, then most recently published — and the sort
code says why in as many words:

> It is deliberately not a popularity score: nothing counts views yet, and
> inventing one would be a claim about other travellers that is not true.

So the last two arrows of the diagram, *reputation → better ranking → more
enquiries*, are the part still to build. They are also the part that makes the
loop a circuit rather than a line, which is why they matter more than their
size suggests.

## How the two halves are wired

One database, two deployed applications, and a public read API between them.

```
journeys.makutano.co.tz          connect.makutano.co.tz
  Makutano Journeys                Makutano Connect
  (SvelteKit, public)              (SvelteKit, operators + platform)
        │                                  │
        └──── /api/public/* ───────────────┤   read-only, cached, CORS-open
                                           │
                                    /api/v1/*  vendor API, key-scoped
                                    /api/mobile/v1/*  the operator's phone
                                           │
                                      one Postgres
```

The marketplace never reaches the database. It reads `/api/public/*` and
nothing else, which is what keeps a public page from ever being able to name a
tenant, and what lets the two halves deploy independently.

Ownership follows the same line. Anything belonging to the platform —
destinations, categories, travel styles, the accommodation directory, tour
publication, review moderation — is `PLATFORM_ONLY` and no tenant role can
touch it. Anything belonging to an operator is tenant-scoped and resolved from
the session, never from a value the browser sent.

## Reading this document

The mission above is the authority. This section and the table are the current
state, and they will go stale — check them against the code before relying on
them. Where the two disagree, the mission wins and the state is a bug report.
