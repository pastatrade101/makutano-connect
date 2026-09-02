# The three projects, and where they run

Written down because none of it is derivable from the code. A repository does
not say which container serves it, a container does not say which branch is
deployed, and nothing at all says that the marketplace repo is called
`makutano-journey` while its directory is `makutano-marketplace`.

Everything below was read off the live host and the repos on 2 September 2026.
Where a fact can go stale it is marked. **Check before relying on it.**

## The three

| | Makutano Connect | Makutano Journeys | Connect Mobile |
|---|---|---|---|
| What it is | Operator portal + platform admin | Public marketplace | Operator's phone app |
| Local directory | `~/Desktop/pastatrade/makutano-connect` | `~/Desktop/pastatrade/makutano-marketplace` | `~/Desktop/pastatrade/makutano-connect-mobile` |
| GitHub | `pastatrade101/makutano-connect` | `pastatrade101/makutano-journey` | `pastatrade101/connect-mobile` |
| Default branch | `main` | `main` | `main` |
| Visibility | private | private | **public** |
| Working branch* | `marketplace-ux-and-enquiry-routing` | `tour-and-operator-page-redesign` | `main` |
| Domain | connect.makutano.co.tz | journeys.makutano.co.tz | — |
| Container | `makutano-connect` | `makutano-journeys` | — |
| Compose dir | `/home/makutano/app/services/connect` | `/home/makutano/app/services/journeys` | — |
| Stack | SvelteKit 2 + Svelte 5, Drizzle, Postgres | SvelteKit 2 + Svelte 5, paid theme | Flutter |

\* Working branches drift. Both web projects have been deploying from a feature
branch, **not `main`** — `main` on each is well behind. Confirm with
`git rev-parse --abbrev-ref HEAD` rather than assuming.

Three names are traps. The marketplace repo is **`makutano-journey`** (singular,
no "s") in a directory called `makutano-marketplace`, serving a site called
**Journeys**. The mobile repo is **`connect-mobile`**, without the `makutano-`
prefix the other two carry, in a directory called `makutano-connect-mobile`. And
`makutano-digital` is a *different, older* application that still runs on the
same host — it is not any of these.

**The mobile repo is public; the other two are private.** Audited at the time it
was pushed: no `.env`, keystore, `google-services.json` or `GoogleService-Info.plist`
in any of its 42 commits, no key-shaped strings in history, no hardcoded
credentials in Dart, and the only URLs are the emulator loopback and the public
API base. So nothing is leaked — but it does mean the operator app's source is
readable by anyone, which is a choice worth making deliberately rather than by
default. Its `.gitignore` already excludes the Firebase files and the Play upload
keystore, and those exclusions are the thing to protect when Firebase is wired up.

## The server

One box carries all of it, alongside several unrelated applications.

```
ssh -p 2807 -i ~/.ssh/makutano_connect_deploy makutano@194.163.139.108
```

`vmi2680790`, Linux 6.8, 6 cores. Everything lives under `/home/makutano/app`,
and the two projects here are `services/connect` and `services/journeys`.

Containers on the shared `makutano-net` network. `makutano-digital-caddy`
terminates TLS for **every** site on the box and proxies over that network, so
neither app publishes a port to the host — the only way in is through Caddy.

## Deploying

**Not `git pull`.** The server holds source that is rsynced to it, and the image
is built there. The marketplace repo is private and carries a paid theme, which
is why it was never wired to pull.

```bash
rsync -rz --checksum --delete \
  -e "ssh -p 2807 -i ~/.ssh/makutano_connect_deploy" \
  --exclude node_modules --exclude .git --exclude build \
  --exclude .svelte-kit --exclude .env \
  src static package.json package-lock.json svelte.config.js \
  tsconfig.json vite.config.ts Dockerfile docker-compose.yml \
  makutano@194.163.139.108:/home/makutano/app/services/<connect|journeys>/
```

then on the server, in that directory:

```bash
docker compose up -d --build
```

Three things that have each cost a debugging session:

- **`docker compose run` uses the IMAGE, not the host directory.** A migration
  or script run before a rebuild executes the *old* code and reports success. It
  once printed "Migrations applied" against a `drizzle/` that did not contain the
  migration. Always `docker compose build` first.
- **`--exclude .env`.** The server's `.env` is the real one and is `600`; an
  rsync without this excludes nothing and overwrites production secrets with
  whatever is local.
- **Caddy is shared.** `config/Caddyfile` at the app root serves a dozen sites.
  Reload it (`caddy reload`), never restart the container, or every site on the
  box goes down with it. Both project blocks carry `encode zstd gzip`; without
  it, server-rendered HTML ships uncompressed — the home page was 267 KB.

## How the two web halves connect

One Postgres, two deployments, a public read API between them.

```
journeys.makutano.co.tz          connect.makutano.co.tz
  (public marketplace)             (operators + platform)
        │                                  │
        └──── /api/public/* ───────────────┤   read-only, cached, CORS-open
                                           │
                                      one Postgres
```

The marketplace **never** touches the database. It reads `/api/public/*` through
`src/lib/api.ts`, whose `BASE` comes from `PUBLIC_CONNECT_API` and defaults to
`https://connect.makutano.co.tz`.

That single rule has been broken exactly once and it is worth remembering how:
a bare `fetch('/api/public/reviews/…')` in a page resolved against the
*marketplace's own* origin, which serves no `/api` routes, so every review
submission 404'd while the page that loaded it worked perfectly. **Any call to
the API from marketplace code goes through `$lib/api`.** A relative `/api` path
there is always a bug.

Cross-origin writes also need the method listed in `CORS.access-control-allow-methods`
in `src/lib/server/public-api.ts`. `PATCH` was missing while the reviews endpoint
exported it, so edits failed at the preflight.

## Database and migrations

Supabase Postgres. Migrations are hand-numbered SQL in `makutano-connect/drizzle/`
with a hand-maintained `meta/_journal.json` — **47 files, latest `0046_activities.sql`**
(stale the moment another lands; check the directory).

```bash
docker compose build connect     # first. see the warning above
docker compose run --rm --no-deps connect node --experimental-strip-types scripts/migrate.ts
```

`txDb()` versus `db()` matters: transactions must use the session connection on
5432. A transaction over the 6543 pooler permanently wedges the pool.

## Media

All marketplace images are in Cloudflare R2, configured by the `R2_*` variables
in Connect's `.env` and served over the bucket's public URL. `src/lib/server/media.ts`
owns every write; object keys are composed server-side from ids the server has
already resolved, never from anything a browser sent.

As of the September 2026 consolidation: **161 objects** in the current bucket,
and **48 deliberately left** in the Goldfinch bucket
(`pub-8de96adc…r2.dev`) at the owner's instruction. Those 48 are in storage this
project does not control — they are pictures that disappear the day that bucket
does. `npm run media:migrate` will bring them across if that changes; remove the
host from `SKIP_HOSTS` first.

The public URL in use is an `r2.dev` development address, which Cloudflare
rate-limits and does not recommend for production. A custom domain would remove
that limit and mean the media rows never have to be rewritten again when a bucket
changes.

## What lives where

- `docs/PRODUCT.md` — what the product is for, and what it rules out. The rule
  that matters most: **no claim the software cannot enforce.** No invented
  counts, no testimonials, no "verified" that is not derived from a record.
- `docs/EDGE.md` — the shared Caddyfile and the compression fix.
- This file — repos, hosts, containers, deploys.

## Reading this document

The tables are current state and will rot. The deployment mechanics and the
`$lib/api` rule are the parts that stay true; verify the branch names, counts and
migration numbers against the repo and the host before acting on them.
