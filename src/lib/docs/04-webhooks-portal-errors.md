## Webhooks to your system

Connect can push events to your backend so your CMS reflects changes without polling.

### Manage endpoints

- `GET /webhooks` — your endpoints + the full event catalogue
- `POST /webhooks` — `{ "url": "https://example.com/hooks/connect", "events": ["booking_request.created", "message.received"] }`. An empty `events` array subscribes to everything. The response includes the signing `secret` — **shown once**, store it server-side
- `DELETE /webhooks/{id}`

Events: `booking_request.created` / `updated`, `booking.created` / `confirmed` / `cancelled`, `lead.created`, `customer.created`, `quotation.sent` / `accepted`, `payment.succeeded` / `failed`, `message.received`.

### Delivery format and verification

Deliveries are JSON POSTs:

```json
{
  "event": "booking_request.created",
  "occurredAt": "2026-08-23T09:12:44.000Z",
  "data": { "id": "…", "reference": "GFA-RQ-2026-00007", "status": "NEW" }
}
```

Each carries `x-makutano-event`, `x-makutano-delivery` (unique id — deduplicate on it) and `x-makutano-signature` in the form `t=<unix>,v1=<hex>`. Verify before trusting:

```js
import crypto from "node:crypto";

export function verifyConnectSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = crypto.createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}
```

Compute over the **raw request bytes**, not re-serialised JSON. Respond `2xx` quickly; anything else is retried with exponential backoff (up to 6 attempts over ~6 hours). Endpoint health — last success, consecutive failures — is visible in the portal under Developers.

## The portal

Everything the API writes is also workable by humans at [connect.makutano.co.tz](https://connect.makutano.co.tz): dashboard, booking requests, bookings, the WhatsApp inbox (read and reply in-thread), quotations, customers, leads, payments, connection health, API keys and webhooks, and tenant settings.

Access is by role, enforced server-side:

| Role | Can |
|---|---|
| `OWNER` / `ADMIN` | Everything for the tenant, including API keys and WhatsApp connection |
| `BOOKING_AGENT` | Sales work plus bookings, payments and traveller passport data |
| `SALES` | Enquiries, quotations, customers, leads, chat — no passports, no payments |
| `VIEWER` | Read-only |

## Errors

| Code | HTTP | Meaning |
|---|---|---|
| `API_KEY_INVALID` / `API_KEY_REVOKED` / `API_KEY_EXPIRED` | 401 | Fix or rotate the key |
| `INSUFFICIENT_SCOPE` | 403 | The key lacks the endpoint's scope |
| `FORBIDDEN` | 403 | Authenticated, but not allowed |
| `*_NOT_FOUND` (`BOOKING_`, `CUSTOMER_`, `QUOTATION_`…) | 404 | Wrong id, or not your tenant's record |
| `VALIDATION_ERROR` | 422 | `details` lists each offending field |
| `IDEMPOTENCY_CONFLICT` | 409 | Key reused with a different body, or original still running |
| `WHATSAPP_NOT_CONNECTED` | 409 | No live number — connect one first |
| `META_API_ERROR` | 502 | Meta rejected a sync send; message includes Meta's reason |
| `PLAN_LIMIT_REACHED` / `FEATURE_NOT_AVAILABLE` | 402 | Monthly quota hit, or feature not in plan |
| `RATE_LIMITED` | 429 | Back off until `details.resetAt` |

Responses never contain stack traces. Every response carries an `x-request-id` header — include it when reporting an issue.

## Support

Integration questions and tenant provisioning: **support@makutano.co.tz** · Makutano Digital, Dar es Salaam.
