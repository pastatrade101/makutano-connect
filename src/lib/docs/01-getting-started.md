## Introduction

Makutano Connect is booking, WhatsApp and payment infrastructure for travel businesses. Your website or CMS stays the interface your team and your travellers see; Connect is the system of record behind it — customers, leads, conversations, booking requests, bookings, quotations and payments, all reachable through one authenticated API.

The integration model is deliberately boring: **one REST API, server to server**. You never embed credentials in a browser, you never talk to Meta yourself, and you never store WhatsApp tokens. Connect owns that layer for every tenant centrally.

```
Client website / CMS
        │  server-to-server API
        ▼
Makutano Connect ── Meta WhatsApp Cloud API
        │
        ▼
   PostgreSQL (per-tenant, isolated)
```

## Getting started

Every business on Connect is a **tenant**. Your tenant is provisioned for you — there is nothing to sign up for. You receive:

| Item | Example | Notes |
|---|---|---|
| API base URL | `https://connect.makutano.co.tz/api/v1` | All endpoints below are relative to this |
| API key | `mk_live_…` | Shown once at creation. Server-side only |

Store both in your backend's environment:

```bash
MAKUTANO_API_URL=https://connect.makutano.co.tz
MAKUTANO_API_KEY=mk_live_xxxxxxxxxxxxxxxx
```

The key must never reach a browser, a mobile app binary, or a public repository. If a key leaks, revoke it in the portal (Developers → API keys → Revoke) — revocation is immediate — and create a new one.

### Authentication

Send the key as a bearer token on every request:

```bash
curl https://connect.makutano.co.tz/api/v1/me \
  -H "Authorization: Bearer $MAKUTANO_API_KEY"
```

`GET /me` is the identity probe: it returns your tenant, the key's scopes, your plan's features and limits, and your WhatsApp connection state. It is the first call to make when wiring an integration.

Your tenant is resolved **from the key** — there is no tenant id parameter anywhere in the API, and nothing you send can address another tenant's data.

### Response envelope

Every endpoint returns one of two JSON shapes:

```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 25, "total": 128, "totalPages": 6 } }
```

```json
{ "success": false, "error": { "code": "BOOKING_NOT_FOUND", "message": "Booking could not be found." } }
```

`meta` appears on list endpoints. Validation failures include a `details` array naming each offending field.

### Idempotency

Every `POST` that creates something accepts an `Idempotency-Key` header (any string up to 255 characters — your own record id is ideal). Retrying with the same key replays the original response instead of creating a duplicate; reusing a key with a *different* body is rejected with `IDEMPOTENCY_CONFLICT`. Keys expire after 24 hours.

```bash
-H "Idempotency-Key: enquiry-8842"
```

Use it on every create call made from a web form handler — a double-submit or a network retry then costs nothing.

### Pagination, filtering, search

List endpoints share the same query parameters: `page` (default 1), `limit` (default 25, max 100), `q` (server-side search), plus endpoint-specific filters such as `status`. Results are newest-first.

### Rate limits

Limits are per tenant and per plan (starting at 60 requests/minute). Exceeding them returns HTTP 429 with code `RATE_LIMITED` and a `resetAt` timestamp in the error details. Back off until then; do not retry in a tight loop.

### Scopes

Keys carry scopes and endpoints enforce them; a request without the needed scope fails with `INSUFFICIENT_SCOPE`:

`booking_requests:read/write` · `bookings:read/write` · `customers:read/write` · `leads:read/write` · `conversations:read` · `whatsapp:read` · `whatsapp:send` · `quotations:read/write` · `payments:read`
