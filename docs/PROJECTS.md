# The three projects: what they are, and what will bite you

**Read this before touching anything.** It exists because none of it is
derivable from the code. A repository does not say which container serves it, a
container does not say which branch is deployed, and nothing at all says that
the marketplace repo is called `makutano-journey` while its directory is
`makutano-marketplace`.

Everything below was verified against the live host, the three repos and the
SvelteKit runtime on **2 September 2026**. Claims that can go stale are marked
_(dated)_. **Check before relying on them.**

---

## 1. What this product is for

One journey, done properly: **a Tanzanian tour operator and a traveller finding
each other, and the trip actually happening.** Not feature parity with
SafariBookings or TourRadar.

Two halves meeting in the middle — _Journeys brings the customer in; Connect
operates the business after the enquiry._ The loop that everything serves:

```
Discover → Compare → Enquire → WhatsApp → Quote → Revise → Accept
   → Book → Pay → Travel → Review → Reputation → better ranking → more enquiries
```

The claimed moat is the last third: a directory never finds out whether the trip
happened, so its reviews are assertions. Here a review requires a completed
booking. `docs/PRODUCT.md` is the authority on all of this and is more current
than `README.md`, whose "not built yet" list is partly stale.

### The rule that matters most

**No claim the software cannot enforce.** Verified means the booking completed.
A rating means somebody travelled. If a badge cannot be derived from a record,
it does not go on a page. This is enforced in code, not just believed:

- reviews have no `isVerified` column — verification _is_ `bookingId NOT NULL`
  (`src/lib/server/reviews.ts:12`)
- the "recommended" sort refuses to become a popularity score
  (`src/lib/server/marketplace.ts:507`)
- the marketplace rating filter does not render until a published review exists
- "Every operator is verified" renders only while derivably true, and removes
  itself when it stops being so

Other standing boundaries: **not e-commerce** (order links are an entry point —
no cart, no browsing, no inventory); **AI never sends anything and never computes
money** (`src/lib/server/ai/assist.ts:1`); depth before breadth.

---

## 2. The three

|                          | Makutano Connect                                | Makutano Journeys                                          | Connect Mobile                                 |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| What it is               | Operator portal + platform admin + every API    | Public marketplace                                         | Operator's phone app                           |
| Directory                | `~/Desktop/pastatrade/makutano-connect`         | `~/Desktop/pastatrade/makutano-marketplace`                | `~/Desktop/pastatrade/makutano-connect-mobile` |
| GitHub                   | `pastatrade101/makutano-connect`                | `pastatrade101/makutano-journey`                           | `pastatrade101/connect-mobile`                 |
| Visibility               | private                                         | private (paid theme)                                       | **public**                                     |
| Working branch _(dated)_ | `marketplace-ux-and-enquiry-routing`            | `tour-and-operator-page-redesign`                          | `main`                                         |
| Domain                   | connect.makutano.co.tz                          | journeys.makutano.co.tz                                    | —                                              |
| Container                | `makutano-connect`                              | `makutano-journeys`                                        | —                                              |
| Compose dir              | `/home/makutano/app/services/connect`           | `/home/makutano/app/services/journeys`                     | —                                              |
| Stack                    | SvelteKit 2 + Svelte 5 runes, Drizzle, Postgres | SvelteKit 2 + Svelte 5, **no Tailwind**, zero runtime deps | Flutter                                        |

Both web repos are **checked out on a feature branch**, and `main` was fast-
forwarded to match on 2 Sep 2026 — so `main` currently _is_ production. The next
commit on a feature branch re-opens that gap. Run `git rev-parse --abbrev-ref
HEAD`; never assume.

**Three names are traps.** The marketplace repo is `makutano-journey`
(singular) in a directory called `makutano-marketplace` serving a site called
Journeys. The mobile repo is `connect-mobile`, without the prefix the others
carry. And `makutano-digital` is a _different, older_ application on the same
host — it is none of these.

---

## 3. How they connect

One Postgres. **Only Connect touches it.** The marketplace has zero runtime
dependencies — no `pg`, no `drizzle` — which makes "never touches the database"
structural rather than aspirational.

```
   Journeys (SSR)          Flutter app         Goldfinch / makutano-digital
        │                       │                          │
        │ /api/public           │ /api/mobile/v1           │ /api/v1
        │ (no auth, CORS *)     │ (bearer session)         │ (mk_live_ API key)
        ▼                       ▼                          ▼
   ┌──────────────────────────────────────────────────────────┐
   │                    Makutano Connect                      │
   │   portal /app · admin /admin · webhooks/meta/whatsapp    │
   └──────────────────────────────────────────────────────────┘
                              │
                        one Supabase Postgres
```

Four authenticated surfaces, not one. The marketplace must **never** use a
relative `/api` path — one `BASE` from `PUBLIC_CONNECT_API`
(`makutano-marketplace/src/lib/api.ts`). A bare `fetch('/api/public/…')` once
404'd every review submission.

---

## 4. Traps that have each cost a debugging session

Ordered by how much damage they do.

**1. A layout `load` does not protect a form action.** SvelteKit runs actions
_before_ any load — its own runtime says so at
`@sveltejs/kit/src/runtime/server/page/index.js:75`. `/admin` was guarded only by
`admin/+layout.server.ts`, so every `?/action` under it ran for whoever asked:
suspend a tenant, publish a listing, or `?/openPortal`, which writes another
tenant's id into the caller's session. **Fixed 2 Sep 2026** by moving the check
into `hooks.server.ts`, which runs before routing. _The lesson generalises: a
guard that lives in a `load` protects reads only._ Note SvelteKit's CSRF origin
check is **not** a substitute — any non-browser client sets `Origin` freely.

**2. `docker compose run` uses the IMAGE, not the host directory.** A migration
or script run before a rebuild executes the _old_ code and reports success. Use
`docker compose exec` against the already-rebuilt container (as
`docker-compose.yml:1-6` documents). Also: `-e VAR=…` does **not** override the
compose `env_file` — a script "pointed at" a scratch database silently ran
against production this way.

**3. Never `db().transaction()` — always `txDb()`.** A transaction over
Supabase's transaction pooler (`:6543`) wedges the pool permanently: no error, no
lock, no slow query, just a later unrelated write hanging forever. `txDb()` uses
`DIRECT_DATABASE_URL` (`:5432`, max 3) and falls back with a single
`console.warn` if that is unset — so the fallback looks like success.

**4. Migrations apply by TIMESTAMP, never by content**
(`src/lib/server/db/migration-integrity.ts`). Editing an already-applied `.sql`
changes nothing on databases that ran it — the DDL looks committed and the column
is simply missing in production. Never move a `when`. The journal is
hand-maintained; a `.sql` without an entry never runs. **48 files, latest
`0047_discovery.sql`** _(dated)_. Migrations are applied **manually** — nothing
runs them on boot — so never deploy code that expects a schema you have not
applied.

**5. A green `npm test` proves little.** 30 of 45 files are `describe.skip`
without `TEST_DATABASE_URL` — 233 pass, **294 skip**, exit code 0. Tenant
isolation, entitlements, the tour lifecycle and moderation are all in the skipped
half. And **never source `.env` into the shell to run tests**: it leaves
`DIRECT_DATABASE_URL` pointing at production, which is how production got test
tenants once already.

**6. Public reads fail EMPTY, never loudly.** The marketplace's `api.ts` catches
everything — non-2xx, network, DNS, parse errors, `success:false` — and returns
`[]` or `null` by design. "Nothing is showing on the marketplace" is never an
error page. Debugging starts at Connect, not at Journeys.

**7. `assertPublishable` gates `submit` ONLY** (`tours.ts:1240`). `approve` and
`publish` never re-check it, and no update path resets status — a PUBLISHED
listing can be gutted and stays live. "Approved" describes a past snapshot.

**8. The paid theme's `style.css` was edited in place.** All 60 occurrences of
the brand terracotta live inside the vendor file; none of the original colour
remains, and the recolour was baked into the import commit, so `git diff` against
the vendor drop shows nothing. **Re-importing or "updating" the theme destroys
the entire brand.** This is why that repo is private and deploys by rsync.

**9. `0 means unlimited` is broken for `api.requestsPerMinute`.**
`hooks.server.ts` reads `(await getLimit(…)) || 60`, so setting 0 to exempt a
tenant yields 60/min — the opposite. The same `||` bug class applies to any
numeric entitlement.

**10. `--exclude .env` is load-bearing.** The server's `.env` is the real one and
is `600`; an rsync without that exclusion overwrites production secrets.

**11. Caddy is shared.** `config/Caddyfile` serves a dozen sites. `caddy reload`,
never restart, or every site on the box goes down together.

---

## 5. Deploying

**Not `git pull`.** Source is rsynced and the image is built on the server.

```bash
rsync -rz --checksum --delete \
  -e "ssh -p <port> -i ~/.ssh/<deploy key>" \
  --exclude node_modules --exclude .git --exclude build \
  --exclude .svelte-kit --exclude .env \
  src static package.json package-lock.json svelte.config.js \
  tsconfig.json vite.config.ts Dockerfile docker-compose.yml \
  <user>@<host>:/home/makutano/app/services/<connect|journeys>/
```

then on the server, in that directory: `docker compose up -d --build`.

Note what that list does **not** carry: `drizzle/`, `scripts/`, `tests/`. Schema
changes never ship by deploying. Host, port, user and key are in the team's
credential store — deliberately not written here or in the public mobile repo.

Verify afterwards: container `healthy`, then hit a public route and an
authenticated one. A route that exists returns 303 to `/login`; one that does not
returns 404 — that difference is how you prove a new page actually shipped.

---

## 6. State of play _(dated)_

**Live and used:** marketplace discovery (destinations, tours, travel styles,
stays, search, compare); public enquiry → Connect booking request; WhatsApp
Cloud API with per-tenant tokens; quotations; the operator portal; platform
admin; operator verification queue (`/admin/marketplace/operators`).

**Built, deployed, zero rows:** Trips. Reviews (the public write path, admin
moderation and the marketplace rating filter all exist and wait for the first
review).

**Built and unrouted:** the discovery ranking model
(`src/lib/discovery/scoring.ts`, 521 lines, 35 passing tests). Its only importer
is its test file, and `tour_impressions` is written by nothing. Anyone told to
"work on ranking" starts by wiring exposure recording, not by writing a model.

**Closed by policy, not dead:** the ORDERS/HYBRID half of the portal is fully
built and live for existing tenants, but signup now accepts only
`TRAVEL_TOURISM`. Half the portal's routes are legacy-by-policy.

---

## 7. Known open issues

Not yet fixed. Each was verified against code.

- **Mobile login has no rate limit** while the web login is 10 per 5 minutes —
  an unthrottled password oracle against the same users table.
- **Mobile login ignores `membership.disabledAt`** and picks a tenant with no
  `orderBy`; a disabled member still signs in.
- **`/api/mobile/*` also accepts the browser session cookie**, not just the
  bearer header.
- **The phone stores its 30-day session token as plain JSON** in
  SharedPreferences, and has **no 401 recovery** — `forgetSession()` is dead
  code, so a revoked session strands the app.
- **Signing out does not deregister push**; the handset keeps receiving customer
  names in notification titles.
- **No `ADDRESS_HEADER`** in Connect's compose file, so the per-IP rate limit
  behind the shared Caddy collapses into one bucket for the whole internet.
- **Nine marketplace routes hardcode the production canonical URL** instead of
  using the `canonical()` helper, so staging would tell Google it is production.
- **`stays/[slug]` renders operator text with `{@html}`** and nothing sanitises;
  latent only because operators cannot edit stays yet.
- **`static/_shots` is 58 MB** of unreferenced contact sheets, tracked, rsynced
  on every deploy and publicly browsable.
- **The Tanzania basemap cannot be regenerated** — `scripts/gis/build_basemap.py`
  hardcodes an ephemeral scratchpad path and the source shapefiles are in neither
  repo.
- **Migration `0047` is applied to production but was never approved**; it is
  inert (two empty tables, one config row).
- **`npm run lint` is broken repo-wide** — `prettier-plugin-svelte` is not
  installed and `.prettierrc` has `plugins: []`, so prettier cannot parse any
  `.svelte` file.
- **The mobile repo's history still contains the production SSH host** (removed
  going forward on 2 Sep 2026; rewriting published history is a separate call).

---

## 8. Keeping this honest

This document is only useful while it is true. When you change how something is
deployed, named, or guarded, change it here in the same commit. When you find a
claim here that is wrong, fix the claim — a document that has lied once gets
checked against the code every time, which costs more than having no document.

Everything marked _(dated)_ is a snapshot. Verify counts, branches and bucket
contents rather than quoting them.
