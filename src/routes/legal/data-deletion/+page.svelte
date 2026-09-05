<!--
	The URL Meta's "User data deletion" field points at.

	Meta requires a page that tells a person how to delete the data an app holds
	about them. The field previously carried https://www.facebook.com/, which is a
	placeholder and explains nothing — an app whose deletion URL does not describe
	deletion is the kind of missing detail that gets Facebook Login restricted.

	Every step below is one that exists in the product today. Nothing here is
	aspirational: the disconnect action is src/routes/app/settings/whatsapp
	(+page.server.ts, action `disconnect`), and it really does overwrite the stored
	token rather than merely flag the row — see whatsapp/connections.ts:272.
-->
<svelte:head>
	<title>Deleting your data · Makutano Connect</title>
	<meta
		name="description"
		content="How to delete the data Makutano Connect holds, including your WhatsApp Business connection and message history."
	/>
</svelte:head>

<h1>Deleting your data</h1>
<p class="!text-xs !text-slate-400">Last updated 5 September 2026</p>

<p>
	This page explains how to remove data that Makutano Connect holds, and what happens when you do. It covers the
	WhatsApp Business connection specifically, because that is the data obtained through Facebook Login.
</p>

<h2>1. What we hold because of WhatsApp</h2>
<p>
	When you connect a WhatsApp Business number, we do not receive your Facebook profile, your friends, your posts or
	your email address. Facebook Login is used for one purpose: to obtain a token that lets us send and receive
	messages on the number you chose. What we store is:
</p>
<ul>
	<li>An access token for your WhatsApp Business account, encrypted at rest.</li>
	<li>The identifiers of the WhatsApp Business account and phone number you selected.</li>
	<li>The messages sent to and from that number while it is connected, and the customer phone numbers attached to them.</li>
</ul>

<h2>2. Disconnect WhatsApp — takes effect immediately</h2>
<p>
	In the portal, go to <b>Settings → WhatsApp</b> and choose <b>Disconnect</b>. This does not queue a request; it
	happens as you click:
</p>
<ul>
	<li>The stored access token is overwritten, not merely marked unused. We can no longer act on your number.</li>
	<li>The connection is marked disconnected and stamped with the time.</li>
	<li>No further messages are sent or received on that number.</li>
</ul>
<p>
	Disconnecting does not delete the conversations you already had. Those are your business records, and deleting them
	is a separate decision — see below.
</p>

<h2>3. Delete messages and customer records</h2>
<p>
	Conversations, enquiries and customer records belong to your business, so you can remove them yourself in the
	portal or through the API without asking us. If one of your own customers asks you to delete their data, that is
	the route: you do it directly, and it takes effect on your account at once.
</p>

<h2>4. Delete the whole account</h2>
<p>
	To have the entire workspace removed — account data, business data and any remaining WhatsApp records — email
	<a href="mailto:support@makutano.co.tz" class="text-brand-600 hover:underline">support@makutano.co.tz</a> from the
	address on the account and ask for deletion. We will confirm the request, carry it out, and reply within
	<b>30 days</b>.
</p>
<p>
	Two things survive that deletion, and only these: records we are required to keep by law, such as accounting
	records for invoices already issued, and security audit entries. Neither contains your message content.
</p>

<h2>5. If you are a customer of one of our operators</h2>
<p>
	If you messaged a tour operator and want your data removed, contact that operator directly — they control it and
	can delete it themselves. We process it on their behalf and cannot delete one business's records on request from
	someone else. If you cannot reach them, email us and we will pass the request on.
</p>

<h2>6. What we never had</h2>
<ul>
	<li>Your password, in readable form.</li>
	<li>Card numbers. Payments are handled by the provider you connect.</li>
	<li>Access tokens or verification tokens in any log or audit record.</li>
</ul>

<h2>7. Questions</h2>
<p>
	Email <a href="mailto:support@makutano.co.tz" class="text-brand-600 hover:underline">support@makutano.co.tz</a>.
	Our full <a href="/legal/privacy" class="text-brand-600 hover:underline">Privacy Policy</a> sets out what we
	collect and how long we keep it.
</p>
