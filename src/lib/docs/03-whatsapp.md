## WhatsApp

Connect operates the Meta WhatsApp Cloud API centrally. Your business keeps ownership of its WhatsApp Business Account and number; Connect stores the credential encrypted, sends on your behalf, receives every inbound message, and threads both into conversations your team can work from the portal — or that you can read over the API.

### Connect a number

From the portal: **WhatsApp → Connect WhatsApp** walks through Meta's Embedded Signup (choose or create the business account, pick the number, done). No tokens are ever shown or pasted.

From your own CMS, request a short-lived onboarding link instead:

`POST /whatsapp/connect-session` — scope `whatsapp:read`

```json
{
  "success": true,
  "data": {
    "launchUrl": "https://connect.makutano.co.tz/connect/whatsapp?session=…",
    "expiresAt": "2026-08-23T12:15:00.000Z",
    "meta": { "appId": "…", "configId": "…", "graphVersion": "v23.0" }
  }
}
```

Redirect your signed-in business user to `launchUrl`. The session is single-use, bound to your tenant, and expires in 15 minutes; the response contains only public Meta identifiers — never a secret.

### Connection status

`GET /whatsapp/connection` — safe health data only:

```json
{
  "success": true,
  "data": {
    "connected": true,
    "connection": {
      "displayPhoneNumber": "+255 658 001 939", "businessName": "Goldfinch Adventures",
      "status": "CONNECTED", "lastWebhookAt": "…", "lastSuccessfulSendAt": "…"
    }
  }
}
```

`POST /whatsapp/disconnect` stops outbound sending but preserves every conversation, message and audit record. Statuses you may observe: `CONNECTED`, `DISCONNECTED`, `ERROR`, `REAUTH_REQUIRED` (token expired — reconnect from the portal).

### Send a message

`POST /whatsapp/messages` — scope `whatsapp:send`. You provide recipient and content; Connect resolves which number and credential to send from. You cannot address another tenant's number — the wire format has no field for it.

```bash
curl -X POST "$MAKUTANO_API_URL/api/v1/whatsapp/messages" \
  -H "Authorization: Bearer $MAKUTANO_API_KEY" \
  -H "Idempotency-Key: reminder-booking-1042" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "255712345678",
    "content": { "type": "text", "text": "Habari Amina — your safari is confirmed for 14 Oct!" }
  }'
```

Content types: `text`, `template` (`templateName`, `language`, optional `components`), `image`, `document`, `interactive`. Free-form messages deliver only inside Meta's 24-hour customer-service window; outside it, use an approved template.

**Dispatch modes.** By default the call returns `202` with `status: "QUEUED"` and a background worker performs the Meta call with retries. Pass `"dispatch": "sync"` to wait for Meta inside the request and receive the real WhatsApp message id (`waMessageId`) — useful when your own system threads delivery statuses by that id. Sync failures surface immediately as `META_API_ERROR`.

### Conversations

Inbound messages create or extend conversations automatically, matched to the customer and, where possible, the booking request that started the exchange.

- `GET /conversations?open=true` — the inbox, newest activity first
- `GET /conversations/{id}/messages` — the thread, oldest-first, with delivery statuses (`SENT → DELIVERED → READ`, or `FAILED` with the Meta error)

### Templates

- `GET /whatsapp/templates` — your approved templates as last synced
- `POST /whatsapp/templates` — queue a re-sync from Meta

In the portal you can map templates to lifecycle events (booking request received, quotation ready, payment received…) so automatic notifications use your approved wording.
