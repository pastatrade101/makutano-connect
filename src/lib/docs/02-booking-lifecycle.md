## The booking lifecycle

Connect keeps the tourism lifecycle explicit. A form submission is an **enquiry**, not a confirmed sale:

```
Traveller enquiry → BOOKING REQUEST → review / conversation / quotation
                 → customer accepts → BOOKING → payment → CONFIRMED
```

Each stage is its own resource with its own statuses, and every record is linked: a request knows its customer, its lead, its WhatsApp conversation, and — once converted — its booking.

## Booking requests

The primary integration point for a website. One call does the whole intake: the customer is **matched or created** (by WhatsApp number, phone, then email — so a returning traveller never duplicates), a sales lead opens, the WhatsApp conversation is linked, and an acknowledgement is sent from your number.

### Create a booking request

`POST /booking-requests` — scope `booking_requests:write`

```bash
curl -X POST "$MAKUTANO_API_URL/api/v1/booking-requests" \
  -H "Authorization: Bearer $MAKUTANO_API_KEY" \
  -H "Idempotency-Key: enquiry-8842" \
  -H "Content-Type: application/json" \
  -d '{
    "customer": {
      "firstName": "Amina", "lastName": "Juma",
      "email": "amina@example.com",
      "whatsappPhone": "0712345678", "country": "TZ"
    },
    "adults": 2, "children": 1,
    "startDate": "2026-10-14T00:00:00.000Z",
    "estimatedTotal": "2400.00", "currency": "USD",
    "notes": "Interested in a mid-October safari.",
    "items": [{
      "title": "3-day Serengeti safari",
      "quantity": 2, "unitPrice": "1200.00",
      "externalReference": "serengeti-3d", "externalSource": "your-cms"
    }]
  }'
```

```json
{
  "success": true,
  "data": {
    "id": "8cd0…", "reference": "GFA-RQ-2026-00007", "status": "NEW",
    "customer": { "id": "…", "firstName": "Amina", "whatsappPhone": "255712345678" },
    "leadId": "…", "conversationId": "…"
  }
}
```

Phone numbers are normalised to international digits using the customer's country (`0712 345 678` + `TZ` → `255712345678`). Keep your own catalog: `externalReference` / `externalSource` on the request and on every item let Connect point back at your tour slug or product id — no catalog migration required.

Useful flags: `createLead: false` skips the pipeline lead; `sendAcknowledgement: false` suppresses the WhatsApp acknowledgement (use it if your system already sends one).

### List, read, update

- `GET /booking-requests?status=NEW&q=amina&page=1` — filters: `status`, `source`, `customerId`
- `GET /booking-requests/{id}` — full detail: items, travellers, internal notes, customer
- `PATCH /booking-requests/{id}` — move `status` through `NEW → UNDER_REVIEW → CONTACTED → QUOTED → ACCEPTED | DECLINED | CANCELLED → CONVERTED`, assign, edit dates/notes

## Bookings

The confirmed commercial record. Money fields are computed server-side from items — a client cannot post a $0 total for a $5,000 trip — and every status change is written to an auditable history.

- `POST /bookings` — scope `bookings:write`. Requires `customerId` and at least one item; link `bookingRequestId` to close the loop (the request flips to `CONVERTED`)
- `GET /bookings?status=CONFIRMED&unpaid=true` · `GET /bookings/{id}` — detail includes items, travellers, payments, status history
- `PATCH /bookings/{id}` — `{ "status": "CONFIRMED", "reason": "Deposit received" }`

Statuses: `DRAFT → PENDING → AWAITING_PAYMENT → PARTIALLY_PAID → CONFIRMED → IN_PROGRESS → COMPLETED`, with `CANCELLED` and `REFUNDED` exits. Illegal jumps (e.g. `PENDING → COMPLETED`) are rejected with `VALIDATION_ERROR`.

Payments recompute `amountPaid` / `balanceDue` automatically, and a fully paid booking advances to `CONFIRMED` on its own.

## Quotations

A quotation can originate from a request, a lead, a conversation or nothing at all.

- `POST /quotations` — scope `quotations:write`. Pass `customerId`, an inline `customer` object (matched like an enquiry), or a `bookingRequestId` to inherit its customer
- `POST /quotations/{id}/send` — snapshots a version, marks `SENT`, flips the linked request to `QUOTED`
- `POST /quotations/{id}/accept` — converts to a booking carrying customer, dates and line items across; idempotent (a second accept returns the same booking)
- `POST /quotations/{id}/decline` — records the outcome
- `GET /quotations?externalReference=GFQ-923025` — look up a quotation you mirrored (below)

### Mirroring an external quotation system

If your CMS already manages quotations, mirror them instead of migrating:

`PUT /quotations/mirror` upserts your quotation's **state as it is** — status (`DRAFT | SENT | VIEWED | ACCEPTED | DECLINED | EXPIRED`), timestamps, totals, display items — keyed on your `externalReference`. Call it on every lifecycle event; replays and out-of-order calls are harmless, and acceptance is recorded as agreement without triggering Connect's own convert-to-booking flow.

## Payments

Traveller payments (separate from your Connect subscription):

- `GET /payments?status=SUCCEEDED` · `GET /payments/{id}` — scope `payments:read`
- `POST /payments` — requires the payments feature on your plan **and** `bookings:write`. Providers: `MANUAL` and `BANK_TRANSFER` today; hosted gateways (Stripe, Flutterwave, Pesapal, AzamPay) return `NOT_CONFIGURED` until enabled for your deployment

A successful payment updates the booking's paid/balance figures and emits `payment.succeeded` to your webhooks.
