## Accounts and onboarding

There are two ways a Makutano Connect account comes into existence, and both run through
the **same provisioning service** — the same transaction, the same defaults, the same
audit trail. Only the starting lifecycle differs.

### Self-service signup

1. **`/signup`** — full name, work email, password, and acceptance of the Terms and
   Privacy Policy. Nothing else is asked on the first screen.
2. **`/verify-email`** — a single-use link, valid for 24 hours. It can be resent, and
   both the account and the network are rate limited.
3. **`/onboarding`** — business name, industry, country, business phone, optional
   website, and a plan.
4. **`/app`** — the dashboard, with a getting-started checklist.

The first user becomes the **Owner** of exactly one tenant. Self-signup can never create
a platform administrator and can never join an existing tenant.

### Admin provisioning

Platform Admin → **Tenants → Provision tenant** creates the tenant immediately in
`ACTIVE`, optionally creates the owner account with a temporary password, and issues a
first API key. Accounts created this way are trusted by the admin who typed the address,
so they skip email verification.

The Tenants list shows how each account arrived — **Self-service**, **Platform Admin** or
**Import** — and can be filtered by it.

### Trials and activation

| `SIGNUP_TRIAL_DAYS` | Tenant status at signup | Subscription |
| --- | --- | --- |
| `14` (default) | `TRIAL` | `TRIALING`, with a real `trialEndsAt` |
| `0` | `PENDING` | none until an admin activates the account |

A trial is a real subscription state, not a bypass: entitlements, monthly limits, tenant
isolation and WhatsApp policy all apply exactly as they do on a paid plan. Nothing in the
signup path marks a subscription as paid.

### Account states

| Status | Portal | Reads | Writes |
| --- | --- | --- | --- |
| `ACTIVE` / `TRIAL` | Full access | Yes | Yes |
| `PENDING` | Redirected to a dedicated screen | Yes | Blocked — `SUBSCRIPTION_INACTIVE` |
| `SUSPENDED` | Redirected to a dedicated screen | Yes | Blocked — `TENANT_SUSPENDED` |
| `CANCELLED` | Redirected to a dedicated screen | Yes | Blocked — `TENANT_SUSPENDED` |

Blocked accounts get one clear explanation rather than a failure on every action, and
their data is never deleted.

### Resuming an unfinished signup

The stage a user belongs to is derived from stored state, not from a cookie or a wizard
step counter:

- no verified address and no tenant → **verify email**
- verified but no tenant → **business setup**
- a member of any tenant → **the portal**

So closing the tab, following the link in a different browser, or signing in a week later
all land on the right screen. Provisioning is idempotent and serialised per user: a
double-clicked submit or a refreshed form resumes the existing tenant instead of creating
a second one.

### Password reset

`/forgot-password` issues a single-use link valid for one hour. `/reset-password` spends
it, sets the new password and **signs out every other session** for that user. Neither
page reveals whether an address has an account.

### What the platform records

Signup and onboarding write these audit events: `signup.started`, `email.verified`,
`tenant.provisioned`, `plan.selected`, `subscription.created`, `onboarding.completed` and
`whatsapp.connected`. Passwords, verification tokens, WhatsApp access tokens and API
secrets are never written to an audit row.

### Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `SIGNUP_ENABLED` | `on` | `off` closes `/signup`; admin provisioning is unaffected |
| `SIGNUP_DEFAULT_PLAN` | `STARTER` | Plan applied when the visitor does not choose one |
| `SIGNUP_TRIAL_DAYS` | `14` | `0` disables trials — new tenants wait in `PENDING` |
| `EMAIL_FROM`, `EMAIL_PROVIDER_KEY` | — | **Required.** Without them verification email cannot be delivered |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | — | Set both to switch on the bot challenge |
