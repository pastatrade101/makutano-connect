# Makutano Connect

## Complete Product and UX Specification

**Version:** 1.0  
**Date:** 28 August 2026  
**Status:** Living product specification

---

## 1. Product vision

Makutano Connect is a multi-tenant SaaS platform for customer communication, enquiries, quotations, bookings, orders, payments, WhatsApp, and business integrations.

The platform should retain significant operational power while feeling understandable within minutes.

### Primary principle

> Do not remove power. Remove the need to understand the power.

Transform:

- Features into journeys
- Modules into actions
- Statuses into next steps
- Configuration into guided setup
- Complexity into progressive disclosure

A user should rarely need to ask, "Where do I go to do this?"

---

## 2. Product goals

Makutano Connect must help users answer:

1. What needs my attention?
2. What can I do now?
3. What should happen next?
4. What is happening in my business?

Users should think in terms of business intent, not internal product architecture.

Examples:

- "I want to start receiving orders."
- "A customer wants a safari."
- "A customer says they have paid."
- "I need to respond to my assigned conversations."

The interface should guide each intent through action, completion, and the next logical step.

---

## 3. Non-negotiable product rules

- Preserve all existing backend services, APIs, webhooks, permissions, entitlements, tenant isolation, and audit history.
- Do not make the sidebar a complete inventory of features.
- Do not put every feature on one page.
- Do not create long wizards for simple work.
- Keep one visually dominant action per screen or state.
- Use business language instead of internal enums and technical IDs.
- Keep advanced functionality accessible through More, Settings, or Developer areas.
- Design for mobile first, then enhance desktop.
- Server-side authorization remains authoritative.
- Empty states teach users how work begins.
- Success states lead users forward.
- Every important record state should have a clear next action when the user is allowed to perform it.

---

## 4. Product architecture

Makutano Connect is one SvelteKit application containing the web UI, server actions, APIs, and background services.

### Main layers

| Layer | Responsibility |
|---|---|
| Customer channels | WhatsApp, public Order Links, hosted forms, websites, and CMS integrations |
| Daily operations | Home, Inbox, Customers, Enquiries, Quotations, Bookings, Orders, Payments |
| Reusable setup | Catalog, templates, forms, payment methods, team, and WhatsApp connection |
| Technical tools | API keys, webhooks, mobile APIs, audit, usage, plans, and platform administration |
| Data and services | PostgreSQL, Drizzle ORM, tenant scoping, permissions, domain lifecycles, and jobs |

Client businesses keep their own websites, branding, catalogs where appropriate, customer relationships, and WhatsApp Business Accounts. Makutano Connect supplies the shared operational infrastructure.

---

## 5. Workspace-aware experience

The workspace determines which business journeys are relevant. It does not replace permissions or plan entitlements.

### BOOKINGS

Primary journey:

`Customer contact -> Enquiry -> Quotation -> Payment -> Booking -> Follow-up`

Prioritize:

- Inbox
- Enquiries
- Quotations
- Bookings
- Payments
- Upcoming trips or services

Do not promote retail Orders, Order Links, or Batches unless explicitly enabled through a genuine hybrid configuration.

### ORDERS

Primary journey:

`Create offer -> Share Order Link -> Receive orders -> Confirm -> Request payment -> Verify -> Fulfil`

Prioritize:

- Inbox
- Orders
- Order Links
- Batches where relevant
- Catalog
- Payments

Do not promote bookings, travel enquiries, or quotations.

### SERVICE

Primary journey:

`Customer contact -> Enquiry -> Quotation -> Payment -> Service delivery`

Prioritize:

- Inbox
- Enquiries
- Quotations
- Payments
- Customers
- Optional Services & Packages

### HYBRID

Show only journeys that are genuinely relevant, entitled, and permitted.

### Visibility rule

A module should appear only when all three conditions are true:

`Workspace relevant x Plan entitled x User permitted`

The server must still authorize every read and mutation.

---

## 6. Roles and permissions

Current roles:

| Role | Product intent |
|---|---|
| SUPER_ADMIN | Platform administration across tenants |
| OWNER | Full business ownership and configuration |
| ADMIN | Business administration and advanced controls |
| BOOKING_AGENT | Presented as Manager; full daily operations, assignment, and payment verification |
| SALES | Agent or consultant handling customers and operational work |
| VIEWER | Read-only access |

There is no dedicated finance role. A finance-focused experience is created from effective permissions, normally a read-only user with `payments:verify` granted.

### Permission principles

- Role supplies default permissions.
- Membership overrides may grant or revoke specific permissions.
- Owner and super-admin permissions cannot be reduced by overrides.
- Finance, agent, owner, and viewer experiences are determined by permissions, not only role names.
- Conversation visibility follows TEAM, ASSIGNED, and PRIVATE rules.
- Personal queues must use real assignments and server-side visibility.
- Payment request, verification, and refund are separate permissions.
- Sensitive traveller data requires a dedicated permission.

---

## 7. Information architecture

Navigation should expose frequent destinations, not every capability.

### Suggested hierarchy

#### Daily

- Home
- Inbox
- Customers

#### Work

- Workspace-specific Enquiries, Bookings, Orders, Quotations, and Payments

#### More

- WhatsApp
- Catalog or Services & Packages
- Forms and Widgets
- Leads
- Integrations
- Settings

### Contextual features

- Order Links should be introduced through Orders and "Start receiving orders."
- Batches should primarily live within the Orders journey.
- Templates should be reached through WhatsApp.
- Integrations should live under More or Settings.
- Technical IDs, API keys, webhooks, and mappings belong in Developer or Admin contexts.

### Mobile navigation

Use a small bottom navigation:

- Home
- Inbox
- Workspace-aware New
- Primary Work destination
- More

Opening a conversation should create a full-screen chat view and temporarily hide global navigation.

---

## 8. Home specification

Home is an operational starting point, not a generic analytics dashboard.

### Required hierarchy

1. Greeting
2. Needs attention
3. Workspace-aware quick actions
4. Today
5. Recent activity
6. Analytics and setup as secondary content

### Owner or admin

Prioritize:

- Business-wide work
- Unassigned conversations
- New enquiries or orders
- Payments awaiting verification
- Bookings awaiting payment
- Operational exceptions

Keep setup and analytics secondary.

### Agent or consultant

Prioritize:

- Assigned conversations needing replies
- Assigned enquiries, bookings, or orders
- Customers waiting for follow-up
- Personal next actions

Do not lead with company-wide analytics or administrative configuration.

### Finance-focused user

Prioritize:

- Customers who say they have paid
- Payments awaiting verification
- Failed payments
- Outstanding requests
- Recent verified payments

Do not show unrelated operational creation actions.

### Viewer

- Show permitted summaries.
- Do not show mutation controls.
- Do not render empty CTA containers.

### Attention model

- Attention is derived on the server.
- Personal work ranks before business-wide work.
- Urgent financial verification ranks highly.
- "Needs you" means the current user can perform the action.
- Users without verification permission see "Waiting for finance" as context, not personal attention.
- Every attention item opens a useful filtered destination.

---

## 9. Inbox and conversation specification

### Mobile Inbox

The mobile Inbox should feel familiar to WhatsApp:

- Compact Chats header
- Search field
- All, Mine, and Open filters
- Customer avatars
- Message preview
- Timestamp
- Green unread badge
- Clear assignment context

### Conversation layout

The conversation screen has three regions:

1. Fixed chat header
2. One scrollable message and context canvas
3. Fixed bottom composer

The input and send button must never scroll away or be pushed off-screen by context panels.

The composer must respect the device safe area and remain usable with the mobile keyboard.

### Conversation context

Show compact access to:

- Customer
- Linked enquiry, quotation, booking, or order
- Payment state
- Assignment
- Visibility
- Presence and typing
- Recommended next action
- AI assistance where appropriate

### Conversation actions

Depending on permissions and workspace:

- Create enquiry
- Create order
- Open linked work
- Take or assign conversation
- Change visibility
- Close or reopen chat
- Delete with elevated permission and explicit confirmation

### AI behavior

- AI creates drafts, not final business decisions.
- Incoming travel messages can become reviewable enquiry drafts.
- Order-like messages can become reviewable order drafts.
- Suggested replies remain editable.
- Payment claims must always require verification.
- AI success states lead to Open record and Suggest reply.

---

## 10. Customer specification

The customer page should tell one connected customer story.

### Page hierarchy

1. Identity and contact
2. One primary action
3. Needs you
4. Current journey
5. Money owed
6. Recent activity
7. Related records

### Journey selection

- The record producing the highest-priority next action becomes the active journey.
- If nothing needs action, use the most recently active relevant record.
- An older record needing verification should outrank a newer inactive record.

### Customer journey stages

Tour or service:

`Enquiry -> Quotation -> Payment -> Booking or delivery`

Order business:

`Order placed -> Confirmed -> Paid -> Delivered`

### Financial behavior

- Show outstanding balances by currency.
- Never add different currencies into one total.
- Show the latest relevant payment state.

### Activity language

Use business events:

- Message received
- Enquiry created
- Quotation sent or accepted
- Order created or confirmed
- Payment requested, reported, or verified
- Booking confirmed
- Order dispatched

Do not expose raw audit keys or internal enum names.

### Related records

Keep conversations, enquiries, quotations, bookings, orders, and payments available through compact sections. Hide irrelevant sections based on workspace.

---

## 11. Enquiries specification

Use the term **Enquiry** consistently. Existing `/booking-requests` URLs and API names may remain unchanged for compatibility.

### Creation

Essential fields:

- Customer name
- Contact number
- What the customer asked for

More details:

- Dates
- Party size
- Budget
- Additional context

Entry points:

- Home
- Quick create
- Enquiries list
- Customer page
- WhatsApp conversation

Conversation-originated enquiries should link the customer and conversation automatically.

### Next action

A new enquiry without a quotation should recommend **Create quotation**.

After creation, show:

- Enquiry created
- Create quotation
- Reply on WhatsApp

### Empty state

Explain that enquiries can be created manually or directly from WhatsApp. Offer Open Inbox and Create enquiry.

---

## 12. Quotations specification

Primary journey:

`Enquiry -> Draft quotation -> Send -> Customer accepts -> Convert to booking`

Rules:

- Quotations normally begin from an enquiry.
- Do not promote New quotation as an isolated global quick action.
- Draft quotation recommends Send quotation.
- Sent or viewed quotation recommends Accept and convert.
- Payment should be requested from the booking created after acceptance.
- Converted quotations link to their booking.
- Creation success is refresh-safe and leads to Send quotation.

Empty state: explain that quotations start from enquiries and link to Enquiries.

---

## 13. Bookings specification

Journey:

`Accepted quotation -> Booking -> Request payment -> Verify -> Confirm -> Start -> Complete`

Next actions:

| State | Primary action |
|---|---|
| Outstanding balance with no request | Request payment |
| Customer reports payment | Verify payment |
| Fully paid pending booking | Confirm booking |
| Confirmed | Start trip or service |
| In progress | Complete |
| Completed or cancelled | No operational action |

Booking detail uses the shared next-action model. Domain services remain responsible for valid transitions.

Sensitive traveller information is permission-gated.

---

## 14. Orders specification

Journey:

`Create or receive -> Confirm -> Request payment -> Verify -> Prepare -> Dispatch -> Deliver`

### New Order

Essential fields:

- Customer
- Item
- Quantity
- Unit and price
- Delivery or pickup

Conditional behavior:

- Variant appears only when needed.
- Delivery location appears only for delivery.
- Switching away from delivery clears stale location data.
- Catalog selection can fill product and price.
- Batch selection can fill item, price, and delivery date.

More options:

- Discount
- Delivery fee
- Payment method
- Source
- Internal notes

The user can save a draft or save for confirmation.

### Order next actions

| State | Primary action |
|---|---|
| Reported payment exists | Verify payment |
| Draft or pending confirmation | Confirm order |
| Confirmed and unpaid | Request payment |
| Confirmed or processing | Mark ready |
| Ready | Dispatch order |
| Dispatched | Mark delivered |
| Delivered, completed, cancelled, or refunded | No operational action |

Manual creation should end in a refresh-safe Order created hand-off.

---

## 15. Order Links specification

Order Links allow sellers without websites to start receiving orders.

Journey:

`Create offer -> Link ready -> Copy, WhatsApp, or QR -> Receive orders -> Open Orders`

Essential fields:

- Product or offer
- Unit
- Price
- Currency
- Pickup or delivery
- Delivery fee when relevant

More options:

- Minimum and maximum quantity
- Description and image
- Closing time
- Delivery date
- Capacity
- Batch
- Payment timing
- Share tags

Success panel requirements:

- Your link is ready
- Display public URL
- Copy link as primary action
- Share to WhatsApp
- Show QR code
- Explain where orders appear
- Link to orders from this link
- Survive page refresh using stable URL state

---

## 16. Order Batches specification

A batch represents a selling or fulfilment round with shared item, price, unit, and fulfilment timing.

Requirements:

- Keep essential batch creation compact.
- Put delivery, pickup, and description under More options.
- Allow order creation to prefill from a batch.
- Support adding customers and coordinating fulfilment.
- Keep batch management contextual within Orders.

Roadmap: bring batch fulfilment into the shared next-action model where domain behavior supports it.

---

## 17. Payments specification

Journey:

`Request payment -> Customer reports payment -> Verify -> Notify -> Continue transaction`

Rules:

- A reported payment is not proof of payment.
- Verification requires `payments:verify`.
- Reported payment outranks lower-priority order or booking actions.
- Verification success links to the related transaction and conversation.
- Users without verification permission see Waiting for finance as context.
- Totals and statistics must label currency correctly.
- Different currencies must never be combined.

Manual and bank-transfer payment handling are implemented. Other payment providers must show Not configured until credentials exist.

Empty state: explain that payment requests begin from an order or booking.

---

## 18. Catalog, leads, forms, and widgets

### Catalog

- Reusable quick-pick list, not a full inventory platform.
- Promoted for ORDERS and HYBRID.
- Optional and called Services & Packages for BOOKINGS and SERVICE.
- Can support order, quotation, and form creation.

### Leads

- Tracks early-stage contacts or opportunities.
- Relevant to booking, service, and hybrid workspaces when enabled.
- Should lead naturally into a customer, enquiry, or conversation.

### Forms and Widgets

- Capture structured enquiries or customer requests from websites.
- Available from setup, empty states, More, and Integrations.
- Should not compete with Inbox in daily navigation.
- Public submissions are validated and tenant-routed on the server.

### Public surfaces

- `/o/[publicId]`: public Order Link ordering page
- `/f/[publicId]`: hosted form
- `/connect/whatsapp`: secure WhatsApp Embedded Signup flow

---

## 19. WhatsApp and templates

### WhatsApp

- Each tenant keeps its own WhatsApp Business Account and phone number.
- Embedded Signup uses a short-lived tenant-bound session.
- Credentials are exchanged and stored server-side.
- Access tokens and secrets never reach the browser.
- Incoming webhooks are signature-verified and deduplicated.
- Messages are tenant-routed by phone number ID.
- The 24-hour service window is enforced.

### Message delivery states

- Queued
- Sent
- Delivered
- Read
- Failed

Conversation ticks should communicate these states using familiar WhatsApp conventions.

### Templates

- Templates live within the WhatsApp area, not permanent primary navigation.
- Template packs are workspace-aware.
- Only reachable business events should be offered.
- WABA IDs, template mappings, event keys, and phone number IDs remain advanced concepts.

---

## 20. Team and assignments

Team management supports:

- Invitations
- Plain-language roles
- Sparse permission overrides
- Assignment of conversations and enquiries
- Conversation visibility
- Presence and typing indicators

Required experience:

- Owners understand business-wide work.
- Agents see assigned work first.
- Finance-focused users see payment work.
- Viewers receive readable access without mutation controls.
- A staff member can answer WhatsApp without gaining company-settings access.

---

## 21. Settings, plans, integrations, and analytics

### Settings

Group configuration by business intent:

- Business profile
- Workspace
- Payment methods
- WhatsApp
- Team
- Notifications
- Advanced configuration

Use progressive disclosure. Do not show every provider or technical field at once.

### Plans

Show:

- Current plan
- Trial state
- Included capabilities
- Usage and limits
- Upgrade or plan-management action

Plan gating does not replace permissions.

### Integrations

Provide clear paths for:

- API keys
- REST APIs
- Webhooks
- Website or CMS integration
- Hosted forms
- Widgets

Technical configuration belongs here, not in daily work.

### Analytics

- Secondary for owners and administrators.
- Do not lead agents or finance-focused users with company-wide charts.
- Operational attention always comes first.

---

## 22. Onboarding specification

Onboarding should feel like business progress, not system administration.

### BOOKING business

1. Connect WhatsApp
2. Configure enquiry flow
3. Choose payment methods
4. Invite team
5. Connect website or CMS optionally

### ORDER business

1. Connect WhatsApp
2. Create first Order Link
3. Choose payment methods
4. Invite team

### SERVICE business

1. Connect WhatsApp
2. Configure enquiry and quotation flow
3. Choose payment methods
4. Invite team

### Required language

Prefer:

- Connect your WhatsApp
- Choose how customers pay
- Invite your team
- Start receiving enquiries
- Start receiving orders

Avoid configuration-heavy terminology for ordinary users.

---

## 23. Progressive disclosure rules

- Essential fields appear first.
- Conditional fields appear only when relevant.
- Advanced fields remain under More options.
- Do not turn simple forms into long wizards.
- Preserve all backend capability and payloads.
- If a hidden field fails validation, automatically open its section.
- Focus the first invalid field where practical.
- Preserve entered values when opening or closing sections.
- Existing advanced values remain discoverable when editing.
- Clear stale values after the condition that required them is disabled.
- Keep one clear primary submit action.

Current high-impact implementations:

- New Order
- Order Link creation
- Batch creation
- New Enquiry More details

---

## 24. Empty, success, and error states

### Empty states

Empty states should explain:

- What this area is for
- How work normally arrives
- The easiest first action
- A useful alternative action

Example:

> No orders yet. Customers can order through a shareable Order Link, WhatsApp, or a manually created order.

### Success states

Never stop at "Successfully created."

Examples:

- Enquiry created -> Create quotation or Reply on WhatsApp
- Quotation created -> Send quotation
- Order created -> Confirm order or next state action
- Order Link ready -> Copy, WhatsApp, or QR
- Payment verified -> Open related order or booking and Open chat

Important hand-offs should survive refresh through stable URL state.

### Error states

- Use plain language.
- Preserve entered data.
- Reveal hidden invalid fields.
- Explain how to recover.
- Never expose stack traces or secrets.

---

## 25. Shared next-action model

One central model decides what should happen next across:

- Home
- Conversations
- Customers
- Enquiries
- Quotations
- Bookings
- Orders
- Payments
- Success panels

Priority principle:

`Money requiring verification -> Customer promise -> Payment request -> Preparation -> Fulfilment -> Completion`

The model recommends an existing action. It does not authorize the user or execute the transition.

Domain services remain authoritative.

---

## 26. Business vocabulary

| Internal concept | User-facing language |
|---|---|
| Booking request | Enquiry |
| REQUESTED payment | Waiting for payment |
| REPORTED payment | Customer says they have paid |
| Reported payment without verification access | Waiting for finance |
| WHATSAPP_GROUP | WhatsApp group |
| PENDING_CONFIRMATION order | Needs confirmation |
| BOOKING_AGENT | Manager |
| Catalog for tour/service tenants | Services & Packages |
| Internal IDs and enum keys | Hidden outside advanced/developer contexts |

Content rules:

- Use short labels and clear verbs.
- Lead with the outcome.
- Avoid unexplained technical language.
- Keep explanations short and purposeful.
- Use the same term on every screen.

---

## 27. Mobile-first specification

- Test every primary screen at 375 px first.
- No horizontal overflow.
- No desktop tables forced onto mobile.
- Comfortable touch targets.
- Correct keyboard type for phone, number, decimal, date, and email.
- One intentional vertical scroll area per task.
- Safe-area padding for bottom controls and sheets.
- Primary actions remain reachable by thumb.
- Full-screen conversation uses dynamic viewport height.
- Composer remains fixed while messages scroll.
- Secondary mobile actions use a bottom sheet where appropriate.
- Avoid sticky submit controls that cover form content or the keyboard.
- Keep attention and current work above analytics and history.

Desktop should enhance the same hierarchy without becoming a wall of cards.

---

## 28. Search specification

Suggested placeholder:

> Search customer, phone or reference...

Group results by:

- Customers
- Conversations
- Enquiries
- Bookings
- Orders
- Payments

Selecting a customer should lead to the unified customer story.

---

## 29. API and integration requirements

The versioned API supports tenant-scoped access to:

- Customers
- Leads
- Conversations and messages
- Enquiries
- Quotations
- Bookings
- Orders
- Catalog
- Payments
- WhatsApp
- Webhooks

Requirements:

- API keys use explicit scopes.
- Write requests support idempotency keys.
- Repeated writes return the original result rather than duplicating records.
- Error responses use stable codes and messages without stack traces.
- API secrets never appear in browser code.
- Webhooks are signed, tenant-scoped, and retried safely.

### Mobile API

Mobile endpoints cover:

- Login and logout
- Current user and workspace
- Device registration
- Work queue
- Inbox list
- Conversation detail
- Assignment
- Sending messages
- Creating enquiries

Mobile APIs must apply the same permissions, workspace rules, visibility, and next-action logic as the web portal.

---

## 30. Security and non-functional requirements

- Tenant scope every query.
- Never trust a browser-supplied tenant ID as authorization.
- Store API keys as hashes.
- Encrypt WhatsApp credentials and webhook secrets.
- Verify Meta webhook signatures against raw request bytes.
- Deduplicate incoming webhook events.
- Enforce permissions and lifecycle transitions on the server.
- Apply per-tenant and per-plan rate limits.
- Use secure cookies, CSRF origin checks, security headers, and redacted logs.
- Keep secrets out of client bundles and logs.
- Keep Home, customer, and list queries bounded.
- Avoid per-record database queries.
- Preserve accessible labels, focus, keyboard behavior, and non-color status cues.

---

## 31. Acceptance scenarios

### A. Tour operator

Task:

> You received a WhatsApp message from someone wanting a safari. Turn it into an enquiry and prepare the next response.

Expected path:

`Inbox -> Message -> Create enquiry -> Review -> Create -> Create quotation or Suggest reply`

### B. WhatsApp seller

Task:

> You sell through WhatsApp and do not have a website. Start taking orders.

Expected path:

`Home -> Start receiving orders -> Create Order Link -> Copy or Share to WhatsApp`

### C. Payment

Task:

> A customer says they have paid.

Expected path:

`Needs attention -> Customer says they paid -> Verify payment -> Related order or booking`

### D. Team

Task:

> Add a staff member who can answer WhatsApp but cannot change company settings.

Expected path:

`Team -> Invite -> Agent`

### E. Existing website

Task:

> Connect an existing website so it can send bookings to Connect.

Expected path:

`More -> Integrations -> API, Form, or Widget guidance`

### F. Permissions

- Viewer can read permitted records.
- Viewer sees no mutation controls.
- Restricted agents never see private conversations in counts or lists.
- Unauthorized direct requests are rejected by the server.

### G. Responsive behavior

Test at 375 px and 1280 px:

- No horizontal overflow
- No hidden primary controls
- Composer remains fixed
- Safe-area behavior is correct
- Deep links open useful filtered destinations
- Refresh-safe hand-offs remain visible

---

## 32. Measurement

Track where practical:

- Time to first WhatsApp connection
- Time to first enquiry or order
- Time to first Order Link and first share
- Time to first payment request
- Time to first payment verification
- Onboarding completion
- Setup-step abandonment
- Attention-item completion
- Navigation dead ends
- AI draft accepted, edited, or discarded
- Frequently used actions by workspace and persona

Use analytics to understand product friction, not to invasively monitor employees.

Browser acceptance tests are not a replacement for real user research. Run short unmoderated tests with people who have never used Connect.

---

## 33. Current implementation status

Implemented product improvements include:

- Workspace-aware BOOKING, ORDER, SERVICE, and HYBRID experiences
- Manual enquiry creation
- Role-aware Home and server-derived attention
- Personal conversation and enquiry work queues
- Finance-focused Home behavior without adding a finance role
- Shared next-action engine
- Refresh-safe transactional hand-offs
- WhatsApp-style mobile Inbox and fixed composer
- Unified customer story
- Order Link sharing panel
- Progressive disclosure for major creation forms
- Business-language status labels
- Teaching empty states
- AI-assisted enquiry, order, and reply drafts
- Workspace-aware WhatsApp templates
- Mobile API work and Inbox surfaces

---

## 34. Prioritized roadmap

### P0

- Run real first-use tests with unfamiliar tour, order, finance, team, and integration users.

### P1

- Add customer identity editing from the customer story.
- Continue improving the assigned enquiry work queue.
- Bring batches into the shared next-action model where appropriate.
- Audit currency labels across payment statistics.

### P2

- Simplify Settings around business outcomes.
- Evaluate a contextual customer-page payment request without duplicating complex payment UI.
- Reassess owner Home density after real usage data.

### P3

- Expand privacy-respecting journey instrumentation.
- Continue accessibility and performance auditing.

---

## 35. Definition of done

A future product change is complete when:

- The screen clearly answers why the user came.
- The next action is obvious.
- There is no more than one dominant CTA.
- Workspace, entitlement, permission, assignment, and visibility rules are respected.
- Server authorization and tenant isolation remain intact.
- Mobile works correctly at 375 px.
- Desktop works correctly at 1280 px.
- Empty, success, error, refresh, and permission-limited states work.
- Hidden-field validation reveals the failing field.
- User-facing terminology follows the central vocabulary.
- Deep links open the correct record or filtered list.
- Automated tests, type checks, and production build pass.
- Important workflows are tested in the browser.
- Major UX hypotheses are scheduled for real-user validation.

---

## Final product test

An owner should think:

> I open Home and immediately know what needs attention.

A consultant should think:

> I work from Inbox and Connect tells me what comes next.

A seller should think:

> I create a link, share it, and orders arrive here.

A finance user should think:

> I open Payments and verify what customers say they paid.

The interface should make the next step obvious without requiring users to understand Makutano Connect's internal architecture.
