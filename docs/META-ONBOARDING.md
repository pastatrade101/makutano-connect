# Meta production readiness — onboarding external businesses

State today: Embedded Signup works end-to-end for **your own** businesses (anyone with a
role on the Meta app). Making it work for **strangers** — a hotel clicking "Connect
WhatsApp" on their own — is gated by Meta review steps, not by code. Connect's side
(`/connect/whatsapp`, `POST /api/v1/whatsapp/connect-session`, token exchange, webhook
routing, per-tenant encryption) is deployed and verified in production.

Work through these in order; each unlocks the next.

## 1. Business Verification  — business.facebook.com → Security Centre
- Verify the Makutano business (registration document, domain or utility bill, phone).
- Status must reach **Verified** before App Review will grant Advanced Access.
- Typical turnaround: 1–5 business days.

## 2. App settings hygiene — developers.facebook.com → your app → Settings → Basic
- App icon, privacy policy URL, terms URL, category — all required for review.
- Add `connect.makutano.co.tz` to **App Domains**.
- Business verification must show as linked to the verified business from step 1.

## 3. Advanced Access via App Review — App Review → Permissions and features
Request **Advanced Access** for exactly these three:
- `whatsapp_business_management`
- `whatsapp_business_messaging`
- `business_management`

For each, the reviewer wants a screen recording showing the real flow:
sign in to Connect → WhatsApp page → Connect WhatsApp → Meta popup → number selected
→ connection shown CONNECTED → a message sent and received. Record against the live
deployment, not localhost. Write the use-case text as: "Multi-tenant booking platform;
each business connects its own WhatsApp Business Account via Embedded Signup to receive
booking enquiries and reply to travellers."

## 4. Tech Provider status — WhatsApp → Solution partners / Tech Provider onboarding
- Complete the Tech Provider questionnaire for the app (Meta's flow inside the WhatsApp
  section). This is what removes the "app-role users only" restriction on Embedded Signup.
- Requires steps 1–3 done.

## 5. Embedded Signup configuration — Facebook Login for Business → Configurations
- The existing config (WHATSAPP_CONFIG_ID in Connect's env) is reused. After Advanced
  Access, confirm it is **published** (not draft) and lists the three permissions above.

## 6. Rate/quality knowledge (operational, no action)
- New WABAs start at 250 business-initiated conversations/day; scales automatically
  with quality. Template sends require approved templates per WABA (Connect syncs them).
- Meta test numbers (like +1 555-144-5676) can only message 5 verified recipients.

## What does NOT need to change
- Webhook: already central at connect.makutano.co.tz, verified.
- Per-tenant credential storage, token encryption, WABA subscription on signup: shipped.
- Client CMSes: integrate over Connect's API with an mk_live key; nothing Meta-facing.
