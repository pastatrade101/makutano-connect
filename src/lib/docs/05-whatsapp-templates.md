## WhatsApp templates to create in Meta

Outside WhatsApp's 24-hour customer-service window you may only send **templates that
Meta has approved**. Connect refuses anything else — no plan or setting overrides that.

Create these in **Meta Business Manager → WhatsApp Manager → Message templates → Create
template**, then in Connect open **Templates**, click **Sync from Meta**, and map each one
to its business event. Connect fires them automatically from then on.

Meta numbers template variables positionally (`{{1}}`, `{{2}}`). Connect fills them **in
the order listed below**, so keep the order exactly as written.

### Booking / service businesses

| Template name | Category | Event to map | Body |
|---|---|---|---|
| `booking_request_received` | UTILITY | BOOKING_REQUEST_RECEIVED | Hi {{1}}, thanks for your enquiry with {{2}}. We've received it (reference {{3}}) and will reply here shortly. |
| `booking_confirmed` | UTILITY | BOOKING_CONFIRMED | Good news {{1}} — your booking {{2}} with {{3}} is confirmed. We look forward to hosting you. |
| `quotation_ready` | UTILITY | QUOTATION_READY | Hi {{1}}, your quotation {{2}} from {{3}} is ready. Total: {{4}}. Reply here with any questions. |
| `payment_reminder` | UTILITY | PAYMENT_REMINDER | Hi {{1}}, a friendly reminder that {{2}} is outstanding on your booking {{3}} with {{4}}. |
| `payment_received` | UTILITY | PAYMENT_RECEIVED | Thank you {{1}} — we've received your payment of {{2}}. Your reference is {{3}}. |
| `trip_reminder` | UTILITY | TRIP_REMINDER | Hi {{1}}, your trip with {{2}} starts on {{3}}. Reply here if you need anything before then. |

**Variables in order**

- `booking_request_received` — customer first name · business name · booking reference
- `booking_confirmed` — customer first name · booking reference · business name
- `quotation_ready` — customer first name · quotation reference · business name · quotation total
- `payment_reminder` — customer first name · amount due · booking reference · business name
- `payment_received` — customer first name · payment amount · booking reference
- `trip_reminder` — customer first name · business name · start date

### Order / commerce businesses

| Template name | Category | Event to map | Body |
|---|---|---|---|
| `order_received` | UTILITY | ORDER_RECEIVED | Hi {{1}}, we've received your order {{2}} ({{3}}). We'll confirm shortly. |
| `order_confirmed` | UTILITY | ORDER_CONFIRMED | Hi {{1}}, your order {{2}} is confirmed. Total: {{3}}. Thank you for shopping with {{4}}. |
| `order_ready` | UTILITY | ORDER_READY | Hi {{1}}, your order {{2}} is ready for collection at {{3}}. |
| `order_dispatched` | UTILITY | ORDER_DISPATCHED | Hi {{1}}, your order {{2}} is on its way to {{3}}. |
| `order_delivered` | UTILITY | ORDER_DELIVERED | Hi {{1}}, your order {{2}} has been delivered. Thank you for choosing {{4}} — reply here if anything isn't right. |

**Variables in order**

- `order_received` — customer first name · order number · items summary
- `order_confirmed` — customer first name · order number · order total · business name
- `order_ready` — customer first name · order number · business name
- `order_dispatched` — customer first name · order number · delivery address
- `order_delivered` — customer first name · order number · business name

### Buttons (optional but recommended)

Templates become far more useful with quick replies. When creating a template, add
**Buttons → Quick reply** with labels such as **Contact us**, **Track order**,
**View booking**. A customer tapping one opens a normal conversation, which re-opens the
24-hour window and lets your team reply freely.

Avoid URL buttons unless the link is stable — Meta re-reviews templates whose URLs change.

### Getting approved first time

- **Category matters.** All of the above are transactional, so choose **UTILITY**.
  Marking them MARKETING invites rejection and costs more per message.
- **No promotional language** in a UTILITY template ("SALE", "discount", "buy now").
- **Never start with a variable.** `{{1}}, your order…` is commonly rejected; `Hi {{1}},
  your order…` passes.
- **Provide sample values** when Meta asks — real-looking ones ("Amina", "MKD-OR-2026-00042",
  "USD 240.00"). Placeholder junk is a frequent rejection reason.
- **One language per template.** To serve Swahili and English, create the same template
  name twice with different language codes (`en`, `sw`); Connect picks by language.
- Approval usually takes minutes, occasionally up to 24 hours.

### After approval

1. Connect → **Templates** → **Sync from Meta** (status becomes APPROVED).
2. Set **Used for** on each template to its event from the tables above.
3. Enable the template.

From then on Connect sends them automatically — for example, confirming an order fires
`order_confirmed` to that customer from your own WhatsApp number, with the variables filled
in. If a template is missing, unapproved or disabled, Connect skips the send and records the
reason rather than failing the underlying business action.
