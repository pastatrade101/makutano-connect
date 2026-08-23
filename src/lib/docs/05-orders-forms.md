## Orders

For businesses that sell through conversation — WhatsApp sellers, retailers, restaurants, wholesalers. An order records who is buying what, for how much, and how it reaches them. Connect is deliberately **not** a storefront, cart or inventory system: the order is a managed record, not a checkout.

Fulfilment status and payment status are independent: `CONFIRMED` does not mean paid, and payments never advance fulfilment on their own.

```
DRAFT → PENDING_CONFIRMATION → CONFIRMED → PROCESSING → READY → DISPATCHED → DELIVERED
                                      (CANCELLED / REFUNDED as exits)
Payment: UNPAID → PARTIALLY_PAID → PAID   (or REFUNDED / FAILED)
```

### Create an order

`POST /orders` — scope `orders:write`

```bash
curl -X POST "$MAKUTANO_API_URL/api/v1/orders" \
  -H "Authorization: Bearer $MAKUTANO_API_KEY" \
  -H "Idempotency-Key: wa-chat-5512" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "…",          
    "source": "WHATSAPP_DIRECT",
    "deliveryMethod": "DELIVERY", "deliveryFee": "5.00",
    "deliveryLocation": "Kariakoo, Dar es Salaam",
    "items": [
      { "title": "Nike Air Max", "variant": "Black / 43", "quantity": 2, "unitPrice": "120.00" }
    ]
  }'
```

Passing a `conversationId` links the order to its WhatsApp thread and inherits the customer automatically. Totals are computed server-side from items (+ delivery, − discount). Acquisition sources: `WHATSAPP_DIRECT`, `WHATSAPP_STATUS`, `WHATSAPP_GROUP`, `WEBSITE`, `INSTAGRAM`, `FACEBOOK`, `MANUAL`, `API`, `OTHER`.

### Manage

- `GET /orders?status=CONFIRMED&paymentStatus=UNPAID&source=WHATSAPP_DIRECT` — list with an items summary per row
- `GET /orders/{id}` — full detail: items, payments, status history, customer, conversation
- `PATCH /orders/{id}` — edit items/delivery **while DRAFT or PENDING_CONFIRMATION only**
- `POST /orders/{id}/status` — `{ "status": "DISPATCHED", "reason": "Boda left 14:20" }`; illegal jumps are rejected
- `POST /payments` with `orderId` — recording a payment recomputes `amountPaid` and the payment status

In the portal, staff open a WhatsApp conversation and click **Create order** — customer, thread and source are pre-filled; they add items and save as a draft for review. AI never finalises an order; a human confirms.

### Catalog

A lightweight quick-pick list (`GET/POST /catalog`, `PATCH /catalog/{id}`) so staff and forms don't retype names and prices — name, type, SKU, price, simple variants, active flag. Businesses with an existing catalog skip it entirely and use `externalReference` on line items.

## Hosted forms & the embeddable widget

The no-code layer for businesses whose current pipeline is *website form → email*. A form is configuration over the same domain services the API uses — never a second engine.

In the portal under **Forms & Widgets** a tenant creates a form from a template — **Booking enquiry**, **Product order**, **Quote request** or **Contact / lead** — toggles fields, sets copy and branding, optionally attaches catalog items and an embed-domain allow-list, then copies either:

- the **hosted URL** — `https://connect.makutano.co.tz/f/{formId}`, or
- the **one-line embed** for any website (plain HTML, WordPress, Webflow, React, Svelte…):

```html
<script src="https://connect.makutano.co.tz/widget.js" data-widget="wf_…"></script>
```

The widget renders in an auto-sizing iframe, so no CSS or JavaScript leaks in either direction.

**Security model.** The browser only ever holds the form's opaque `wf_…` id. Submissions go to `POST /api/public/widgets/{id}/submit`, where Connect resolves the tenant server-side, applies per-visitor and per-form rate limits, a honeypot, payload caps and the origin allow-list — then routes into the normal services: booking/quote forms create booking requests, order forms create `PENDING_CONFIRMATION` orders (never auto-paid, never auto-fulfilled — and on catalog-backed forms, prices always come from the tenant's catalog, never the visitor), lead forms create customers + leads. No API key exists anywhere in this path; regenerating the form id instantly invalidates every published embed.

## Template Center

Under **WhatsApp → Template Center**, tenants design reusable message templates with **named variables** instead of Meta's positional `{{1}}, {{2}}`:

```
Hello {{customer.first_name}}, your order {{order.number}} has been
confirmed. Total: {{order.total}}.
```

Available variables include `customer.first_name`, `business.name`, `order.number`, `order.total`, `order.items_summary`, `delivery.address`, `booking.reference`, `quotation.reference`, `payment.amount`, `payment.link`. Templates support a header, footer and up to three buttons (quick-reply or URL).

Connect converts the design to Meta's format and submits it for approval (`DRAFT → SUBMITTED → APPROVED / REJECTED`, synced from Meta). Once approved, map it to a business event:

| Event | Fires when |
|---|---|
| `ORDER_RECEIVED` | An order arrives from a form or the API awaiting confirmation |
| `ORDER_CONFIRMED` / `ORDER_READY` / `ORDER_DISPATCHED` / `ORDER_DELIVERED` | Fulfilment transitions |
| `PAYMENT_RECEIVED` | A payment against an order succeeds |
| `BOOKING_REQUEST_RECEIVED`, `BOOKING_CONFIRMED`, `QUOTATION_READY`, `PAYMENT_REMINDER`, `TRIP_REMINDER` | Booking-side events |

Your code emits the event; the tenant's mapping decides what the customer receives, from the tenant's own number. Free-form chat in the Inbox stays free-form — templates exist for business-initiated notifications outside the 24-hour window.

## Order webhooks

The webhook catalogue gains `order.created`, `order.confirmed`, `order.processing`, `order.ready`, `order.dispatched`, `order.delivered`, `order.cancelled`, `order.refunded` — same delivery format, signature and retries as every other event, with `externalReference` included for reconciliation.
