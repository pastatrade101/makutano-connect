# The four projects: what they are, and what will bite you

**Read this before touching anything.** It exists because none of it is
derivable from the code. A repository does not say which container serves it, a
container does not say which branch is deployed, and nothing at all says that
the marketplace repo is called `makutano-journey` while its directory is
`makutano-marketplace`.

Everything below was verified against the live host, the four repos and the
SvelteKit runtime on **2 September 2026**, and re-verified during the Phase 2
tracking rollout on **4 September 2026**. Claims that can go stale are marked
_(dated)_. **Check before relying on them.**

---

## 0. Agent rules

**Read this section before touching anything.** Each rule is here because
breaking it has already cost real time or real production state. Where a rule
has a number in brackets, that is the trap in section 4 that explains it.

Before modifying anything:

1. **Read this document completely.** Not this section — the document. The
   traps are the part that saves you.
2. **Identify which of the four projects the task belongs to.** Connect,
   Journeys, Connect Mobile, or Traccar. Three of the four names are
   misleading; check section 2 rather than trusting a directory name.
3. **Confirm the local repository path.** `~/Desktop/pastatrade/makutano-…`,
   and the marketplace directory does not match its repo name.
4. **Confirm the current Git branch and HEAD** — `git rev-parse --abbrev-ref
HEAD` and `git log -1`. Two repos sit on feature branches; `main` matching
   production is a snapshot, not a rule.
5. **If deploying, confirm the live Compose working directory from the RUNNING
   CONTAINER**, never from a path that looks right:
   `docker inspect <container> --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`.
   For Connect, use `tool/deploy.sh`, which refuses to run unless the container
   agrees. [12]
6. **Never infer production state from a local directory.** A stale copy of
   this repo exists on the server and nothing runs from it. Local files, local
   `.env`, local `docker-compose.yml` and the local git checkout all describe
   your machine, not production. [12] [13]
7. **Never deploy `.env`.** Production's is the real one, is `600`, and lives
   only on the server. `tool/deploy.sh` proves it is untouched by comparing its
   sha256 before and after. [10]
8. **Never overwrite Connect's production `docker-compose.yml`** until the repo
   and server Compose are reconciled — the server defines `tracking-worker` and
   the repo does not, so syncing the file deletes the worker service. [13]
9. **Never run a migration until its journal entry and production ordering are
   verified.** Migrations apply by timestamp and are run by hand; a `.sql`
   without a journal entry never runs, and editing an applied one changes
   nothing. [4]
10. **Never use production databases for tests.** Sourcing `.env` into a shell
    leaves `DIRECT_DATABASE_URL` pointing at production, which is how
    production acquired test tenants once already. [5]
11. **Do not modify another project merely because it is related.** A tracking
    change in Connect is not a licence to touch the mobile app. If a second
    project genuinely needs a change, say so and get agreement first.
12. **If this document conflicts with observed production state: STOP, report
    the discrepancy, and update this document only after establishing which is
    true.** The document is evidence, not authority. A document that has lied
    once gets re-checked against the code every time, which costs more than
    having no document at all.

Two habits that are not rules but prevent most of the above: prove a claim
against the running system before acting on it, and when something "did not
work", first check that what you changed is the thing that is running.

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

## 2. The four

Three applications and the tracking platform they depend on. The fourth is
infrastructure, not a product — but it holds credentials, stores position
history, and nothing about it is derivable from the other three repos.

|                          | Makutano Connect                                | Makutano Journeys                                          | Connect Mobile                                 | Makutano Traccar                        |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- |
| What it is               | Operator portal + platform admin + every API    | Public marketplace                                         | Operator's phone app                           | Vehicle tracking platform (self-hosted) |
| Directory                | `~/Desktop/pastatrade/makutano-connect`         | `~/Desktop/pastatrade/makutano-marketplace`                | `~/Desktop/pastatrade/makutano-connect-mobile` | `~/Desktop/pastatrade/makutano-traccar` |
| GitHub                   | `pastatrade101/makutano-connect`                | `pastatrade101/makutano-journey`                           | `pastatrade101/connect-mobile`                 | local only _(no remote)_                |
| Visibility               | private                                         | private (paid theme)                                       | **public**                                     | local                                   |
| Working branch _(dated)_ | `marketplace-ux-and-enquiry-routing`            | `tour-and-operator-page-redesign`                          | `main`                                         | `master`                                |
| Domain                   | connect.makutano.co.tz                          | journeys.makutano.co.tz                                    | —                                              | tracking.makutano.co.tz                 |
| Containers               | `makutano-connect`, `makutano-tracking-worker`  | `makutano-journeys`                                        | —                                              | `traccar`, `traccar-db`                 |
| Compose dir              | `/home/makutano/app/services/connect`           | `/home/makutano/app/services/journeys`                     | —                                              | `/home/makutano/app/services/traccar`   |
| Stack                    | SvelteKit 2 + Svelte 5 runes, Drizzle, Postgres | SvelteKit 2 + Svelte 5, **no Tailwind**, zero runtime deps | Flutter                                        | `traccar/traccar:6.15.3` + Postgres 16  |

Both web repos are **checked out on a feature branch**, and `main` was fast-
forwarded to match on 2 Sep 2026 — so `main` currently _is_ production. The next
commit on a feature branch re-opens that gap. Run `git rev-parse --abbrev-ref
HEAD`; never assume.

**The Traccar repo holds only compose + docs.** The container image is upstream
and pinned. `docs/HARDENING-V2.md` is the audit of the deployed instance and
`docs/HARDENING-V2-PROPOSAL.md` the 20-part plan it produced; Phases 1 and 2 of
that plan are implemented in **Connect**, not here.

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
          │                                        │
   one Supabase Postgres          makutano-tracking-worker (same image,
                                  different entrypoint, ONLY holder of the
                                  Traccar provisioning credential)
                                                   │
                                          ┌────────────────┐
                driver's phone ──────────▶│ Traccar 6.15.3 │
                (Traccar Client, OsmAnd)  │  + its own PG  │
                                          └────────────────┘
```

**Traccar is never reached by a browser.** No iframe, no proxied UI, no
credentials in the client. Connect's web process reads positions with a
**per-tenant read-only** Traccar user; the worker alone holds the privileged one.
A driver's phone talks to Traccar directly over `/osmand` and to nothing else.

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

**9. `0 means unlimited`, and the ways that gets written by accident.**
Fixed 2 Sep 2026: `hooks.server.ts` now uses `isUnlimited()` like every other
consumer. The trap was never the read — it was the WRITES. The plans editor
rendered every absent numeric as a literal `0`, the save loop ran over every
entitlement, and `updatePlan` replaces rather than merges, so one click on Save
to change a plan's PRICE persisted `api.requestsPerMinute: 0`. Harmless while the
reader said `|| 60`; "no limit at all" once the reader was correct. A blank
per-tenant override did the same through `Number(value) || 0`. Empty now means
unset, and an unreadable override is refused. **If you touch entitlement writes,
check what an absent field persists as.**

**10. `--exclude .env` is load-bearing.** The server's `.env` is the real one and
is `600`; an rsync without that exclusion overwrites production secrets.

**11. Caddy is shared.** `config/Caddyfile` serves a dozen sites. `caddy reload`,
never restart, or every site on the box goes down together.

**12. `--exclude .env` is not enough — the DESTINATION is also load-bearing.**
`/home/makutano/connect/` exists, contains a full stale copy of this repo, and
**nothing runs from it**. Production is `/home/makutano/app/services/connect/`.
An rsync to the wrong one reports success, the build succeeds, and the change
simply never appears — which reads as "the fix did not work" and sends you back
into code that was already correct. Confirm with the container itself, never with
the directory name:
`docker inspect makutano-connect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'`.
Cost on 4 Sep 2026: two deploys that did nothing, plus overwriting the stale
directory's `.env` while believing it was production's.

**13. The server's `docker-compose.yml` is AHEAD of the repo's.** Production
defines both `connect` and `tracking-worker`; the repo's file defines only
`connect`. Rsyncing it deletes the worker service. **Exclude
`docker-compose.yml`** until the repo catches up.

**14. A tab open across a deploy looks like a broken button.** Every build
renames the hashed client chunks and deletes the old ones, so a page loaded
before a deploy asks for filenames that are gone. The dynamic import 404s
_after_ `use:enhance` has called `preventDefault`, so the visible symptom is a
button that does nothing at all — no error, no navigation. Reported twice as "the
button does not submit" before the console showed the 404s. Mitigated by
`version.pollInterval` + `vite:preloadError` handling in the root layout; if you
see a dead button, hard-refresh before debugging the form.

**15. A partial unique index is checked per STATEMENT, not at commit.**
`te_one_active_key` allows one ACTIVE enrollment per vehicle. Replacing a tracker
activated the new row before closing the old one, so the first statement always
violated the index — the transaction aborted and the worker retried forever while
the operator saw the new phone stuck on "waiting". Order the close first. There
is no deferred-constraint escape hatch here; the index is not `DEFERRABLE`.

**17. An iOS device install fails on a framework Flutter never signs.**
Flutter's native-assets pipeline emits `objective_c.framework` **ad-hoc**
signed (`Signature=adhoc`, no team identifier) and Xcode's embed step does not
re-sign it. Ad-hoc is accepted on the simulator and rejected on a handset, so
`flutter install` dies with `0xe8008014 (The executable contains an invalid
signature.)` — which reads like a provisioning or team-id fault and is not one.
The team is fine; one nested bundle is not. Clearing `build/` **and**
`build/native_assets/` does not help; it comes out ad-hoc every time. Root
cause is in `flutter_tools/bin/xcode_backend.dart`, which gates native-asset
codesigning on `platform == TargetPlatform.macos` — so iOS never re-signs them.
`objective_c` arrives transitively via `path_provider_foundation`; nothing in
the repo asked for it. Use `tool/ios-device-install.sh`, which re-signs
anything still ad-hoc and re-seals the bundle.

**This affects the development path ONLY.** Verified 4 Sep 2026 against a real
Release Archive and the exported App Store IPA: every embedded framework,
`objective_c.framework` included, carries `TeamIdentifier=25X3LP3BZ6`, and both
pass `codesign --verify --deep --strict`. Do not carry the re-signing workaround
into Archive, TestFlight or App Store builds. Re-check after a Flutter or Xcode
upgrade.

The same gap costs one dSYM. Because the framework is built outside Xcode's
normal compile and link, no `objective_c.framework.dSYM` is produced — every
other framework has one — and the upload warns `Upload Symbols Failed`. It is a
warning, not a rejection: the build uploads and ships. The only consequence is
that a crash inside that FFI glue reports raw addresses instead of symbols.

**16. In Traccar, `disabled` is NOT revocation.** A disabled device keeps
accepting and storing positions — proven against 6.15.3. The only revocation is
**deleting** the device. Equally: `/api/positions` silently **ignores**
`uniqueId`, so a query that looks scoped returns everything the caller can see.
Always resolve `uniqueId → numeric deviceId` through `/devices` first and scope
by `deviceId`. Both of these have already caused a cross-tenant leak once.

**18. A WhatsApp template can be APPROVED and still send nothing — three ways.**
All three are silent: no error surfaces, the Template Center looks healthy, and
the only visible symptom is a traveller who is never acknowledged. Found on
5 Sep 2026 from one enquiry, and each layer hid the next.

- **No event mapping.** Meta returns what a template _says_, never what it is
  _for_, so `syncTemplates` stored `event_key` NULL and `variables` `[]`.
  `templateForEvent` found nothing, callers fell back to free text, and Meta
  refuses free text outside the 24-hour window. **44 templates** across
  production were in this state — Makutano Digital 11/11, Pastatrade 18/18,
  Goldfinch 15/21. Only tenants provisioned through the pack were sound, which
  is the tell: the pack sets the mapping at draft time, a plain sync never did.
- **Templates belong to a WABA.** Reconnecting a tenant to a different WABA left
  the previous one's rows in place and every send returned
  `(#132001) Template name does not exist in the translation`.
- **The setup button hid itself.** Whether to offer the pack was decided by a
  version number stored on the TENANT, so a tenant marked "version 8 applied"
  with zero templates on its new WABA was offered nothing at all: an empty
  table, a Sync from Meta that correctly returns nothing, and no way forward.

Now: the sync maps by pack name and prunes what Meta no longer lists;
`templateForEvent` heals a missing mapping on first use (`template_mapping_healed`);
`upsertConnection` enqueues a sync, which nothing did before; and
`packNeedsSetup()` also asks whether the pack's WABA is the live one, treating an
empty Template Center as needing setup whatever the version says.

_Read the log before the code._ `template_send_skipped` = variables unresolved.
`132001` = wrong WABA. `booking_request_ack_failed` with the 24-hour text = no
template was found at all.

---

## 5. Deploying

**For Connect, use `tool/deploy.sh`.** It is the only supported path and it
refuses to run unless the destination matches the compose directory the running
container reports, no `.env` or `docker-compose.yml` appears in the transfer
list, and production's `.env` is byte-identical afterwards. It prints the commit
before, stamps the deployed commit on the server, and asserts a 200 on a public
route and a 303 on a guarded one.

```bash
DEPLOY_SSH_HOST=<user>@<host> DEPLOY_SSH_KEY=~/.ssh/<key> tool/deploy.sh
```

The manual form below is what that script does, and is documented because
Journeys has no equivalent yet.

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

The destination is `/home/makutano/app/services/<connect|journeys|traccar>/`.
Read trap 12 before typing a path — a sibling `/home/makutano/connect/` exists
and is a decoy. For Connect, also `--exclude docker-compose.yml` (trap 13). The
tracking worker is a separate service in the same project and the same image:
after changing anything under `src/lib/server/tracking/` or `scripts/`, rebuild
it too — `docker compose up -d --build tracking-worker`. Rebuilding `connect`
alone leaves the worker on the old code, and the worker is the half that talks to
Traccar.

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

**Enquiry notifications _(5 Sep 2026)_.** A new booking request notified IN_APP
and by email and stopped there — push existed but was wired only to WhatsApp
inbound, conversation assignment and contact events, so the one notification
that costs real money to miss never buzzed. It now pushes to the same
OWNER/ADMIN recipients as the email, carrying `conversationId` because that is
the only key the mobile app routes on. Verified twice in production
(`push_sent sent: 2`). The WhatsApp acknowledgement to the traveller is trap 18.

**Built, deployed, blocked on Meta:** multi-tenant WhatsApp onboarding. The
Embedded Signup code is correct and complete — the SDK bootstrap, `config_id`,
token exchange and per-tenant sealing all work, and they work today for a number
on our own business portfolio. External businesses cannot connect: Meta answers
the login dialog with "Feature Unavailable ... we are updating additional details
for this app".

That is NOT a code fault and no code change reaches it. Everything Meta gates on
is green, checked on the dashboard 5 Sep 2026 rather than assumed:

| Gate                     | State                                 |
| ------------------------ | ------------------------------------- |
| Permissions              | Advanced Access approved              |
| App mode                 | Published                             |
| Data Use Checkup         | Complete                              |
| Required actions         | Clear                                 |
| Business verification    | **Approved**                          |
| App Review documentation | **Approved**                          |
| **Tech Provider**        | **Granted** — "2 of 2 steps complete" |

Note the trap: the _Overview_ checklist still shows "Become Tech Provider"
unticked while the Become Tech Provider page itself says the status is granted.
The Overview tick is stale. Do not diagnose from it.

So the remaining difference is HOW Embedded Signup is invoked. Meta issued a
**Meta-hosted** Embedded Signup landing page for this app —
`business.facebook.com/messaging/whatsapp/onboard/?app_id=…&config_id=…` — while
Connect calls the **JS SDK** flow (`FB.login` with the same `config_id`) from our
own domain. The config id matches in both (`2051446678830297`). The open question
is whether this config is provisioned for the hosted flow only, or whether
`connect.makutano.co.tz` is missing from Facebook Login's JS SDK allowed domains.

The cheap experiment that separates them: send the Meta-hosted link to an external
business. If that works and ours does not, the app is fine and the fault is in how
we invoke it — check Facebook Login for Business → Settings (JS SDK allowed
domains, valid OAuth redirect URIs) and → Configurations. If the hosted link also
fails, it is app-level and nothing in `src/lib/server/whatsapp/` will help.

Either way, check that before changing signup code. "Works for us, fails for
clients" survives any amount of rewriting.

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

### Two different things are both called "Phase 2"

Neither document is wrong; they number different axes, and nobody renumbered
either because both are the historical record of a decision.

- **This document** numbers the OPERATIONAL capability a tenant gets.
- **`makutano-traccar/docs/HARDENING-V2-PROPOSAL.md`** numbers the IMPLEMENTATION
  steps that shipped it, ordered so production is never broken between them.

| Capability (here)              | Implementation steps (proposal)                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| Phase 1 — credential isolation | Phase 0 (probe), 1 (schema), 2 (admin path, dark), 3 (one tenant), 5 (remove the shared credential) |
| Phase 2 — phone enrollment     | Phase 4 (enrollment UI + read-path hardening)                                                       |
| Phase 3 — position retention   | Phase 7 (retention, dry-run first)                                                                  |
| —                              | Phase 6 (image pins) — infrastructure, no capability                                                |

So "Phase 2 is done" means **phone enrollment** in this document and **the dark
admin path** in the proposal. When either is quoted without its source, say which.

### Reserved columns that are deliberately not written

Found during the 5 Sep audit. None of these is a bug to fix by starting to write
them — a column filled in without a decision about who owns it becomes a second
source of truth that disagrees with the first.

| Column                             | State                                                                                                     | What it would need                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vehicles.last_fix_at`             | **Reserved, never written.** Every write sets null; the one read is a fallback that therefore never fires | A decision on who writes it, what invalidates it, and what it should mean during a provider outage — a remembered "last seen" shown during an outage is a lie |
| `tracker_enrollments.first_fix_at` | **In use.** Written on activation and enforced by `te_evid_chk`                                           | Nothing — the audit's grouping of this with the unused columns was wrong                                                                                      |

### Tracking revocation has no trigger _(5 Sep 2026)_

`disableTenantAccount()` in `traccar-admin.ts` has **zero callers**. The effect
side is already wired — `credentials.ts` treats a disabled identity as no
identity — so what is missing is only the event that should invoke it, and
wiring it somewhere plausible is worse than leaving it visible.

The events that should plausibly revoke, in order of how clearly they qualify:

1. **Tenant status → SUSPENDED or CANCELLED** (`/admin/tenants`). Enforcement
   today is request-time only (`entitlements.ts`, `api-keys.ts`), which covers
   access _through Connect_ and says nothing about the provider identity itself.
2. **Offboarding / tenant deletion**, where the Traccar user should not outlive
   the account.
3. **Losing the tracking entitlement** on a plan change.
4. **Suspected compromise** of the sealed credential — an operations action, and
   the case the function's own comment was written for.

**Answer this before wiring it: what re-enables?** Nothing currently clears
`disabled_at` or re-enables the Traccar user, so a reinstated tenant would stay
dark with no signal, and the person reinstating them has no reason to suspect a
tracking-specific step exists. Revocation without a matching restore path turns a
reversible suspension into an irreversible one by accident.

### Tracking UX _(6 Sep 2026, not yet deployed)_

The Live Map is a two-mode workspace: **Live** draws every vehicle the tenant
owns from the one fleet poll (`/app/tracking/positions`, 25 s, paused while the
tab is hidden, refreshed at once on return); **Route history** fetches one
bounded range once (`hours` 1–24 — the backend has no `from`/`to`, so "Custom"
is a bounded hour count, not a date range) and replays it entirely in the
browser: prev/play/next, a scrubber, 0.5–4×, start/end/selected markers,
cumulative distance along the recorded fixes. No smoothing, no snapping, no
invented points. Pure helpers in `src/lib/tracking/{replay,presentation}.ts`.

Two contract refinements, both additive: a truncated history now keeps the
**most recent** `MAX_POSITIONS` (2,000) points instead of the earliest, and
sends `limit` so clients say the real number; the mobile tracking endpoints
accept the same bounded `hours`. Every client now shows `truncated` — the flag
had been computed and sent since day one and read by nothing.

Mobile: the sheet leads with a tappable vehicle row (icon, name, plate, state),
polling pauses when the app is backgrounded, presets Today / 6 h / 24 h.

Still true: no Vehicle Details screen exists in the app, and no per-vehicle
page on the web beyond tracker setup — the header row leads to what exists.

### Vehicle tracking _(4 Sep 2026)_

|                              |                                                            |
| ---------------------------- | ---------------------------------------------------------- |
| V1 fleet & trip tracking     | ✅ Live                                                    |
| Phase 1 credential isolation | ✅ Verified                                                |
| Phase 2 phone enrollment     | ⚠️ Live — one step short of verified (no handset scan yet) |
| Phase 3 position retention   | ⬜ Not started                                             |
| Tracking UX                  | ✅ Live                                                    |

**Phase 1 — security prerequisites: live.** Two Traccar identities, split by
job. Provisioning belongs to `tracking-worker@tracking.invalid` (NOT an
administrator: `deviceLimit -1`, `userLimit -1`), held **only** by the
`makutano-tracking-worker` container. Runtime reads use a **per-tenant,
read-only** Traccar user whose password is sealed with AES-256-GCM in
`tracking_accounts`. The web container holds **zero** privileged Traccar
credentials — verify with
`docker inspect makutano-connect ... | grep -c TRACCAR_ADMIN` and expect `0`.
Migrations `0049` and `0050` are applied.

**Phase 2 — phone enrollment: LIVE, one step short of verified _(4 Sep 2026)_.**
An operator creates a setup code, the driver scans it with Traccar Client, and
the worker binds the vehicle on the phone's first real fix.

The server-side lifecycle was exercised end to end against production and
passed: provision, activate, worker restart mid-flight, cancel, expire, replace
and revoke. The web process makes **no** provider call during enrollment —
`status` reads the ledger alone.

**What has NOT been done: a real handset has never scanned a generated QR.**
Activation was proven by posting protocol-identical OsmAnd fixes, because the
only phone running Traccar Client is the live Toyota tracker, which was
explicitly out of scope. So the server accepts and binds a first fix correctly;
what remains unproven is the link before it — that Traccar Client parses our QR,
stores exactly `https://tracking.makutano.co.tz/osmand` with no query string,
and needs no manual identifier entry.

One replacement bug was found by that verification and fixed (trap 15); it had
shipped, so the flow was live and broken until 4 Sep.

Note also that the single production enrollment row is a **backfill**, not a
Phase 2 enrollment: `Land Cruiser 1` has `provider_device_id`, `provisioned_at`
and `first_fix_at` all null, and its Traccar device carries a hand-made
`uniqueid` rather than a minted 16-character reference. No vehicle in production
has yet been onboarded through this flow and kept.

Facts that are easy to get wrong:

- The enrollment ledger is the source of truth. `PENDING → PROVISIONED → ACTIVE`,
  closing to `CLOSED` with a reason (`CANCELLED`, `EXPIRED`, `REPLACED`,
  `REMOVED`). Rows are **never deleted** — the history is the audit trail.
- `cancel` acts on `PENDING`/`PROVISIONED` only; `remove` is the revocation path
  for an `ACTIVE` tracker. They are different actions on purpose.
- Revocation **deletes** the Traccar device. Disabling does not revoke (trap 16).
- Replacement keeps the old tracker reporting until the new phone's first fix,
  then switches in one transaction. Nothing goes dark.
- The QR is bearer-like configuration material. It is served `no-store`,
  `no-referrer`, only while `PROVISIONED` and unexpired, and the raw identifier
  is never rendered in the page. Anyone who photographs it can configure another
  phone — accepted for V1, and the reason the page says so in plain words.

Traccar now holds exactly three identities and no more: the human
administrator (`pastory56@gmail.com`), one per-tenant read-only user, and the
worker's non-admin provisioning user. The Phase 1 identity
`provisioning@tracking.invalid` was a leftover full administrator; it was
proven unreferenced by environment, database, permissions, managed-user links,
scripts and code, then deleted on 4 Sep 2026.

**Phase 3 — position retention: not started.** `tc_positions` grows unbounded.
This is the next piece of work, and it is deliberately not begun.

---

## 7. Known open issues

Not yet fixed. Each was verified against code.

- **`/api/mobile/*` also accepts the browser session cookie**, not just the
  bearer header.
- **The phone stores its 30-day session token as plain JSON** in
  SharedPreferences, and has **no 401 recovery** — `forgetSession()` is dead
  code, so a revoked session strands the app.
- **Signing out does not deregister push**; the handset keeps receiving customer
  names in notification titles.
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
- **`xcodebuild` cannot authenticate to team `25X3LP3BZ6`**, though Xcode's UI
  can. The CLI reads `Xcode-Token` keychain items which vanished on 5 Sep 2026;
  signing in through Settings → Accounts restored the UI session but not those,
  so `-exportArchive` still fails `No Account for Team`. **Uploading works
  through Window → Organizer → Distribute App** — builds 8 and 9 went that way.
  A distribution certificate now exists (created 5 Sep 2026; the previous one's
  private key was lost, and a certificate cannot be re-downloaded without it).
  The durable fix, not yet done, is an App Store Connect API key passed as
  `-authenticationKeyPath`, which has no session to expire.
- **`cancelEnrollment` on an ACTIVE row is a silent no-op that reports
  success.** The action always returns `{cancelled: true}` regardless of whether
  a row matched. Unreachable from the UI (an ACTIVE tracker renders `remove`,
  not `cancel`), so it is an honesty gap rather than a live bug.
- **The `cancel` and `remove` actions have no try/catch**, unlike `start` and
  `extend`. A malformed `enrollmentId` produces a raw 500 instead of a clean
  `fail()`. The database message stays server-side.
- **The tracking worker service exists only on the server** — the repo's
  `docker-compose.yml` does not define it (trap 13). Until that is reconciled,
  every Connect deploy must exclude the compose file.
- **The public mobile repo carries the production SSH host** in
  `docs/PUSH-SETUP.md` (host, port `2807`, username), plus eight tracked
  `.idea/*` files and a `flutter_01.log` crash dump that `.gitignore` claims to
  exclude. Not a credential — the deploy key is not there, and the IP resolves
  from public DNS anyway — so this is reconnaissance, not a breach. Left as-is by
  the owner's decision; do not "fix" it unprompted.

---

## 8. Keeping this honest

This document is only useful while it is true. When you change how something is
deployed, named, or guarded, change it here in the same commit. When you find a
claim here that is wrong, fix the claim — a document that has lied once gets
checked against the code every time, which costs more than having no document.

Everything marked _(dated)_ is a snapshot. Verify counts, branches and bucket
contents rather than quoting them.

Last full pass: **4 September 2026**, during Phase 2 tracking verification.
