# Makutano Connect

Multi-tenant SaaS engine for reusable WhatsApp, bookings, leads, quotations, payments
and client-CMS integrations — built as **one SvelteKit project**, not a split
frontend/backend.

> **Core principle.** Makutano Connect owns the reusable infrastructure. The client
> keeps their own website/CMS, branding, customers and WhatsApp Business Account, while
> Makutano provides the central engine through secure APIs. Integrate once and consume
> the service — like Stripe or Twilio — instead of rebuilding the same functionality for
> every website.

```
Client Website / CMS
        |  server-to-server API (Bearer mk_live_…)
        v
Makutano Connect (SvelteKit)
        +-- Tenants / Users / API keys / Audit
        +-- Customers / Leads / Conversations
        +-- Booking requests -> Quotations -> Bookings -> Payments
        +-- WhatsApp (Embedded Signup, messaging, webhooks, templates)
        +-- Notifications / Client webhooks / Usage & billing
        v
PostgreSQL
```

## Stack

| Concern    | Choice                             | Why                                                                  |
| ---------- | ---------------------------------- | -------------------------------------------------------------------- |
| App        | SvelteKit 2 + Svelte 5, TypeScript | One repo, one deployable; server routes, actions and UI together     |
| Database   | PostgreSQL + Drizzle ORM           | Typed schema, plain SQL migrations, no binary engine                 |
| Validation | Zod                                | Params, query, bodies, webhook payloads **and** environment          |
| Styling    | Tailwind CSS v4                    | Dense operational UI                                                 |
| Jobs       | Postgres-backed queue              | No Redis to run; jobs are transactional with the data that made them |
| Adapter    | `@sveltejs/adapter-node`           | Runs anywhere Node runs                                              |

There is **no** separate Express/Nest/Fastify backend, by design.

## Getting started

```bash
npm install
cp .env.example .env      # then fill in the values
npm run db:migrate
npm run db:seed           # plans; set SEED_SUPER_ADMIN_EMAIL for a platform admin
npm run dev
```

### Using Supabase

Supabase **is** Postgres, so its connection string goes straight into `DATABASE_URL`
(`SUPABASE_DB_URL` is accepted as an alias). Two URLs matter:

| Use                | Supabase connection string          | Variable              |
| ------------------ | ----------------------------------- | --------------------- |
| Running app        | **Transaction pooler**, port `6543` | `DATABASE_URL`        |
| Migrations / seeds | **Direct connection**, port `5432`  | `DIRECT_DATABASE_URL` |

The pool already runs with `prepare: false`, which is what the transaction pooler
requires. Migrations need the direct connection because DDL and the migrator's advisory
lock need a session that survives between statements. Append `?sslmode=require`.

This project talks to Postgres directly rather than through `supabase-js`: the spec
calls for server-side tenant scoping and an ORM, and every query here is already
tenant-scoped in application code.

## Layout

```
src/lib/server/     auth, db, tenants, api-keys, whatsapp, bookings, customers, leads,
                    quotations, payments, billing, encryption, webhooks, notifications,
                    jobs, audit, rate-limit, idempotency
src/routes/app      tenant portal (optional — clients may stay in their own CMS)
src/routes/admin    super admin
src/routes/api/v1   external API consumed by client websites
src/routes/webhooks Meta webhooks (signature-authenticated, not API-key)
src/hooks.server.ts one pipeline: request id, auth, tenancy, rate limits, headers
```

## Integrating a client website

Store these on the **server** of the client site. The browser must never see the key.

```bash
MAKUTANO_API_URL=https://connect.example.com
MAKUTANO_API_KEY=mk_live_xxxxxxxxx
```

```bash
curl -X POST "$MAKUTANO_API_URL/api/v1/booking-requests" \
  -H "Authorization: Bearer $MAKUTANO_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": { "firstName": "Amina", "whatsappPhone": "0712345678", "country": "TZ" },
    "adults": 2,
    "items": [{ "title": "3-day Serengeti", "externalReference": "serengeti-3d",
                "externalSource": "client-cms" }]
  }'
```

The client keeps its own tour catalog: `externalReference` / `externalSource` let
Makutano point at a slug, package id or product id without migrating the catalog.

### Endpoints

| Method    | Path                                                          | Scope                                         |
| --------- | ------------------------------------------------------------- | --------------------------------------------- |
| GET       | `/api/v1/me`                                                  | `customers:read`                              |
| GET POST  | `/api/v1/booking-requests`                                    | `booking_requests:read` / `:write`            |
| GET PATCH | `/api/v1/booking-requests/:id`                                | `booking_requests:read` / `:write`            |
| GET POST  | `/api/v1/bookings`                                            | `bookings:read` / `:write`                    |
| GET PATCH | `/api/v1/bookings/:id`                                        | `bookings:read` / `:write`                    |
| GET POST  | `/api/v1/customers`, `/api/v1/leads`                          | `customers:*`, `leads:*`                      |
| GET       | `/api/v1/conversations`, `/api/v1/conversations/:id/messages` | `conversations:read`                          |
| GET POST  | `/api/v1/quotations`                                          | `quotations:read` / `:write`                  |
| POST      | `/api/v1/quotations/:id/send`, `/:id/accept`                  | `quotations:write`, `bookings:write`          |
| GET POST  | `/api/v1/payments`                                            | `payments:read` (+`bookings:write` to create) |
| POST      | `/api/v1/whatsapp/connect-session`                            | `whatsapp:read`                               |
| GET       | `/api/v1/whatsapp/connection`                                 | `whatsapp:read`                               |
| POST      | `/api/v1/whatsapp/messages`, `/whatsapp/disconnect`           | `whatsapp:send`                               |
| GET POST  | `/api/v1/webhooks`                                            | `whatsapp:read` / `:send`                     |

Envelopes are uniform, and never contain a stack trace:

```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "BOOKING_NOT_FOUND", "message": "Booking could not be found." } }
```

Send `Idempotency-Key` on any write. A replay returns the original response with
`idempotent-replayed: true`; the same key with a different body is rejected with
`IDEMPOTENCY_CONFLICT`.

## WhatsApp

The client keeps their own Business Portfolio, WABA and phone number. Makutano stores
and operates the connection centrally, under the correct tenant.

1. The client's CMS calls `POST /api/v1/whatsapp/connect-session` with its API key.
2. It redirects the user to the returned `launchUrl` (a short-lived, single-use,
   tenant-bound token — not a tenant id).
3. Meta's Embedded Signup popup returns an authorization code to the browser.
4. The **server** exchanges it, proves the token can read that `phone_number_id`,
   registers the number, subscribes the app to its webhooks, and stores the token
   AES-256-GCM encrypted.

The Meta app secret, the encryption key and the access token never reach the browser.

Point Meta's webhook at `https://<host>/webhooks/meta/whatsapp` using
`WHATSAPP_VERIFY_TOKEN`. Inbound events are HMAC-verified against the **raw** bytes,
routed to a tenant by `phone_number_id`, and deduplicated on Meta's message id.

## Booking lifecycle

A web form submission is an inquiry, not a confirmed booking:

```
Traveller inquiry -> BOOKING REQUEST -> review / conversation / quotation
                  -> customer accepts -> BOOKING -> payment -> CONFIRMED
```

References are generated by an atomic counter, never `COUNT + 1`:
`EMN-RQ-2026-00001`, `EMN-BK-2026-00001`, `EMN-QT-2026-00001`.

## Security

- Tenant scoping on every query; a `tenant_id` from a browser or caller is never authorization
- API keys stored only as `sha256`; the secret is shown once
- WhatsApp tokens and webhook secrets encrypted (AES-256-GCM, versioned for rotation)
- Server-side permission checks — hidden UI controls are not authorization
- Passport fields gated behind `travelers:read_sensitive`
- Meta webhook signature verification over raw bytes
- Per-tenant, per-plan rate limits — never one global bucket
- Secure cookies, CSRF origin checks, security headers, redacting logger
- No secrets in client bundles, no raw tokens in logs, no stack traces in responses

## Testing

```bash
npm test                                     # unit tests
createdb makutano_test
DIRECT_DATABASE_URL=postgres://…/makutano_test npm run db:migrate
TEST_DATABASE_URL=postgres://…/makutano_test npm test    # + isolation & lifecycle
```

Without `TEST_DATABASE_URL` the database-backed suites **skip loudly** rather than
appearing to pass. They cover the spec's mandatory cases: tenant A cannot read tenant B,
API key A cannot reach tenant B, WhatsApp A cannot send with B's credentials, a repeated
`Idempotency-Key` creates one record, a duplicate Meta webhook creates one message, a
revoked key stops immediately, and tampered tenant ids are ignored.

## Commands

| Command                          | Does                                 |
| -------------------------------- | ------------------------------------ |
| `npm run dev`                    | Dev server                           |
| `npm run build` / `npm start`    | Production build / run               |
| `npm run check`                  | Typecheck                            |
| `npm run lint` / `format`        | Lint / format                        |
| `npm test`                       | Tests                                |
| `npm run db:generate`            | Generate a migration from the schema |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed plans        |

## Status

Version 1 covers multi-tenancy, API keys, WhatsApp connection and messaging, customers,
leads, conversations, booking requests, bookings, quotations, payments, client webhooks,
usage and audit logs.

Deliberately not built yet: AI agents, mobile apps, ERP/warehouse features and visual
workflow builders. The extension points are in place — `events.ts` for domain events,
`payments/providers.ts` for provider adapters, and `jobs/handlers.ts` for background work.

Payment providers: `MANUAL` and `BANK_TRANSFER` are fully implemented. Stripe,
Flutterwave, Pesapal and AzamPay are declared against the same interface and report
`NOT_CONFIGURED` until credentials are added — they do not pretend to charge cards.
