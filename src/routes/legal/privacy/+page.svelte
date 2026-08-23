<svelte:head><title>Privacy Policy · Makutano Connect</title></svelte:head>

<h1>Privacy Policy</h1>
<p class="!text-xs !text-slate-400">Last updated 23 August 2026</p>

<h2>1. Two kinds of data</h2>
<p>
	<b>Account data</b> is about you as our customer: your name, email, business details and how you use the portal.
	We are the controller of that data. <b>Business data</b> is what your own customers send you — enquiries, orders,
	messages, contact details. You control that; we process it on your behalf and only to run the service for you.
</p>

<h2>2. What we collect</h2>
<ul>
	<li><b>Account:</b> full name, work email, business name, industry, country, business phone and optional website.</li>
	<li><b>Security:</b> a hash of your password (never the password itself), session records, and a hash of your IP address for rate limiting and abuse detection.</li>
	<li><b>Business data:</b> customer names and contact details, enquiries, bookings, orders, quotations, payments and WhatsApp message history for your account.</li>
	<li><b>Operational:</b> request logs, audit records of significant actions, and usage counters used to apply plan limits.</li>
</ul>

<h2>3. What we do not collect</h2>
<ul>
	<li>We do not store your password in a readable form.</li>
	<li>We do not store card numbers. Payments are handled by the payment provider you connect.</li>
	<li>We do not put access tokens, API secrets or verification tokens into audit logs.</li>
	<li>We do not sell your data or your customers' data, and we do not use it to train models.</li>
</ul>

<h2>4. Why we process it</h2>
<ul>
	<li>To provide the service you signed up for (performance of a contract).</li>
	<li>To keep the service secure and prevent abuse (legitimate interests).</li>
	<li>To bill you and keep accounting records (legal obligation).</li>
	<li>To send service messages such as email verification and account notices.</li>
</ul>

<h2>5. Who else is involved</h2>
<ul>
	<li><b>Meta Platforms</b> — WhatsApp message delivery, if you connect a number.</li>
	<li><b>Our hosting and database providers</b> — to run the service and store your data.</li>
	<li><b>Our email provider</b> — to deliver verification and notification emails.</li>
	<li><b>Your payment provider</b> — if you enable payments.</li>
</ul>
<p>We share only what each provider needs, and we do not give any of them the right to use your data for their own purposes.</p>

<h2>6. Isolation between customers</h2>
<p>
	Every record in the system carries the account it belongs to, and every query is scoped to the account of the
	authenticated caller. An API key can only ever read and write its own account's data. This is enforced in the
	service itself, not by convention.
</p>

<h2>7. How long we keep it</h2>
<ul>
	<li>Business data: for as long as your account is open, and then only as long as the law requires.</li>
	<li>Sessions: 30 days, or until you sign out.</li>
	<li>Email verification and reset tokens: hours, and they are single-use.</li>
	<li>Audit logs: retained as a security record.</li>
</ul>

<h2>8. Your rights</h2>
<p>
	You can access, correct, export or delete your account data — email
	<a href="mailto:support@makutano.co.tz" class="text-brand-600 hover:underline">support@makutano.co.tz</a> and we
	will respond within 30 days. If one of your own customers asks you to delete their data, you can do that yourself in
	the portal or through the API.
</p>

<h2>9. Your customers' consent</h2>
<p>
	You are responsible for having permission to message the people you contact through the service, and for telling
	them how you use their data. The service records opt-outs and enforces them on every send.
</p>

<h2>10. Changes</h2>
<p>We will notify you by email or in the portal before any material change to this policy takes effect.</p>
