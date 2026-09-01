// Team management (§team-access brief): one company, one WhatsApp number, many staff
// accounts, individual permissions. Builds on tenant_memberships + the existing
// role/permission matrix; invitations reuse the hashed single-use token machinery.
//
// Safety rails baked in, not bolted on:
//  - the last active OWNER can never be removed, deactivated or demoted (§12)
//  - self-signup-grade rules still hold: nothing here can mint a platform admin
//  - seat limits come from the plan (platform.maxUsers); the plan always wins
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { audit } from './audit';
import {
	effectivePermissions,
	isCustomized,
	PERMISSIONS,
	permissionsForRole,
	type Permission
} from './auth/permissions';
import { issueToken } from './auth/verification';
import { db, schema } from './db';
import { getLimit } from './entitlements';
import { emailReady, env } from './env';
import { AppError } from './errors';
import { enqueue } from './jobs/queue';
import { log } from './logger';
import { getTenantById } from './tenants';

/* ------------------------------------------------------------- role labels ---- */

/** Business-language labels for the existing role enum — never rename the values. */
export const ROLE_OPTIONS: ReadonlyArray<{ value: schema.Role; label: string; hint: string }> = [
	{ value: 'ADMIN', label: 'Admin', hint: 'Runs the business: team, settings, templates, refunds' },
	{ value: 'BOOKING_AGENT', label: 'Manager', hint: 'Full inbox, assigns conversations, verifies payments' },
	{ value: 'SALES', label: 'Agent', hint: 'Inbox and day-to-day transactions' },
	{ value: 'OPERATIONS', label: 'Operations', hint: 'Prepares trips: hotels, vehicles, guides, passports. No money.' },
	{ value: 'CREW', label: 'Driver / Guide', hint: 'Sees only the trips they are on, and can update those' },
	{ value: 'VIEWER', label: 'Viewer', hint: 'Read-only access' }
];

export function roleLabel(role: schema.Role): string {
	if (role === 'OWNER') return 'Owner';
	if (role === 'SUPER_ADMIN') return 'Platform admin';
	return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}

/** Grouped, human-labelled permission catalogue for the editor UI (§10). */
export const PERMISSION_GROUPS: ReadonlyArray<{
	group: string;
	items: ReadonlyArray<{ key: Permission; label: string }>;
}> = [
	{
		group: 'Inbox',
		items: [
			{ key: 'conversations:read', label: 'View inbox (team conversations + own assignments)' },
			{ key: 'conversations:view_all', label: 'View all conversations' },
			{ key: 'conversations:view_private', label: 'View private conversations' },
			{ key: 'conversations:write', label: 'Reply to customers and add internal notes' },
			{ key: 'conversations:assign', label: 'Assign conversations and change visibility' },
			{ key: 'whatsapp:send', label: 'Send WhatsApp messages' }
		]
	},
	{
		group: 'Customers & enquiries',
		items: [
			{ key: 'customers:read', label: 'View customers' },
			{ key: 'customers:write', label: 'Create and update customers' },
			{ key: 'booking_requests:read', label: 'View enquiries' },
			{ key: 'booking_requests:write', label: 'Handle enquiries' },
			{ key: 'leads:read', label: 'View leads' },
			{ key: 'leads:write', label: 'Manage leads' }
		]
	},
	{
		group: 'Bookings',
		items: [
			{ key: 'bookings:read', label: 'View bookings' },
			{ key: 'bookings:write', label: 'Create, update and confirm bookings' },
			{ key: 'travelers:read_sensitive', label: 'View traveller passport details' }
		]
	},
	{
		group: 'Orders',
		items: [
			{ key: 'orders:read', label: 'View orders and batches' },
			{ key: 'orders:write', label: 'Create, update and confirm orders' },
			{ key: 'order_links:read', label: 'View order links' },
			{ key: 'order_links:write', label: 'Create and edit public order links' },
			{ key: 'order_links:archive', label: 'Archive order links' }
		]
	},
	{
		group: 'Quotations',
		items: [
			{ key: 'quotations:read', label: 'View quotations' },
			{ key: 'quotations:write', label: 'Create and send quotations' }
		]
	},
	{
		group: 'Payments',
		items: [
			{ key: 'payments:read', label: 'View payments' },
			{ key: 'payments:write', label: 'Record payments' },
			{ key: 'payments:request', label: 'Request payment from customers' },
			{ key: 'payments:verify', label: 'Verify reported payments' },
			{ key: 'payments:refund', label: 'Refund payments' }
		]
	},
	{
		group: 'WhatsApp',
		items: [
			{ key: 'whatsapp:read', label: 'View WhatsApp status' },
			{ key: 'whatsapp:templates', label: 'Manage message templates' },
			{ key: 'whatsapp:connect', label: 'Manage the WhatsApp connection' }
		]
	},
	{
		group: 'Administration',
		items: [
			{ key: 'members:read', label: 'View the team' },
			{ key: 'members:write', label: 'Manage the team' },
			{ key: 'tenant:read', label: 'View settings' },
			{ key: 'tenant:write', label: 'Manage settings' },
			{ key: 'forms:read', label: 'View forms & widgets' },
			{ key: 'forms:write', label: 'Manage forms & widgets' },
			{ key: 'api_keys:read', label: 'View API keys' },
			{ key: 'api_keys:write', label: 'Manage API keys' },
			{ key: 'webhooks:read', label: 'View webhooks' },
			{ key: 'webhooks:write', label: 'Manage webhooks' },
			{ key: 'audit:read', label: 'View the audit log' }
		]
	}
];

/* ----------------------------------------------------------------- queries ---- */

/** The numbers an admin glances at before lunch: is anyone drowning? (§23 — light.) */
export async function teamWorkload(tenantId: string) {
	const rows = (await db().execute(sql`
		select
			(select count(*)::int from conversations c where c.tenant_id = ${tenantId}::uuid and c.is_open = true) as open_total,
			(select count(*)::int from conversations c where c.tenant_id = ${tenantId}::uuid and c.is_open = true and c.assigned_to_user_id is null) as open_unassigned,
			(select count(*)::int from messages m where m.tenant_id = ${tenantId}::uuid and m.direction = 'OUTBOUND' and m.sent_by_user_id is not null and m.created_at::date = current_date) as replies_today
	`)) as unknown as Array<{ open_total: number; open_unassigned: number; replies_today: number }>;
	return rows[0] ?? { open_total: 0, open_unassigned: 0, replies_today: 0 };
}

/**
 * Names for a picker. One indexed query, no workload counters.
 *
 * listTeam carries two correlated subqueries per member — open conversations
 * and replies today — which the settings page renders and an assignee dropdown
 * throws away. Opening a trip should not cost a workload report.
 */
export async function listAssignableMembers(tenantId: string) {
	const rows = await db()
		.select({
			userId: schema.users.id,
			fullName: schema.users.fullName,
			email: schema.users.email,
			role: schema.tenantMemberships.role
		})
		.from(schema.tenantMemberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
		.where(and(eq(schema.tenantMemberships.tenantId, tenantId), isNull(schema.tenantMemberships.disabledAt)))
		.orderBy(asc(schema.users.fullName));
	return rows.map((r) => ({
		id: r.userId,
		name: r.fullName || r.email,
		role: roleLabel(r.role)
	}));
}

export async function listTeam(tenantId: string) {
	const rows = await db()
		.select({
			membership: schema.tenantMemberships,
			user: schema.users,
			assignedOpen: sql<number>`(
				select count(*)::int from conversations c
				where c.tenant_id = ${tenantId}::uuid
					and c.assigned_to_user_id = ${schema.tenantMemberships.userId}
					and c.is_open = true
			)`,
			repliesToday: sql<number>`(
				select count(*)::int from messages m
				where m.tenant_id = ${tenantId}::uuid
					and m.sent_by_user_id = ${schema.tenantMemberships.userId}
					and m.direction = 'OUTBOUND'
					and m.created_at::date = current_date
			)`
		})
		.from(schema.tenantMemberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
		.where(eq(schema.tenantMemberships.tenantId, tenantId))
		.orderBy(desc(schema.tenantMemberships.createdAt));

	return rows.map((r) => ({
		membershipId: r.membership.id,
		userId: r.user.id,
		fullName: r.user.fullName,
		email: r.user.email,
		role: r.membership.role,
		roleLabel: roleLabel(r.membership.role),
		status: r.membership.disabledAt ? 'Deactivated' : r.membership.acceptedAt ? 'Active' : 'Invited',
		customized: isCustomized(r.membership.role, r.membership.permissionOverrides),
		overrides: r.membership.permissionOverrides ?? {},
		effective: effectivePermissions(r.membership.role, r.membership.permissionOverrides),
		lastActiveAt: r.user.lastLoginAt,
		assignedOpen: r.assignedOpen,
		repliesToday: r.repliesToday
	}));
}

async function membershipOf(tenantId: string, membershipId: string) {
	const [row] = await db()
		.select({ membership: schema.tenantMemberships, user: schema.users })
		.from(schema.tenantMemberships)
		.innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
		.where(and(eq(schema.tenantMemberships.id, membershipId), eq(schema.tenantMemberships.tenantId, tenantId)))
		.limit(1);
	if (!row) throw new AppError('NOT_FOUND', 'Team member not found.');
	return row;
}

/** The §12 rail: is this membership the tenant's last standing owner? */
async function isLastActiveOwner(tenantId: string, membershipId: string): Promise<boolean> {
	const target = await membershipOf(tenantId, membershipId);
	if (target.membership.role !== 'OWNER') return false;
	const [{ value: others }] = await db()
		.select({ value: count() })
		.from(schema.tenantMemberships)
		.where(
			and(
				eq(schema.tenantMemberships.tenantId, tenantId),
				eq(schema.tenantMemberships.role, 'OWNER'),
				isNull(schema.tenantMemberships.disabledAt),
				sql`${schema.tenantMemberships.id} <> ${membershipId}::uuid`
			)
		);
	return Number(others) === 0;
}

/* ------------------------------------------------------------------ invite ---- */

// Every role the team UI offers must appear here, or it is a dead option: both
// inviteMember and changeRole gate on this list.
const INVITABLE_ROLES: schema.Role[] = ['ADMIN', 'BOOKING_AGENT', 'OPERATIONS', 'CREW', 'SALES', 'VIEWER'];

/** Exposed so a test can assert the UI never offers a role the server refuses. */
export function assignableRoles(): schema.Role[] {
	return [...INVITABLE_ROLES];
}

export type InviteInput = {
	fullName: string;
	email: string;
	role: schema.Role;
	invitedByUserId: string;
};

/**
 * Invite a member. An existing Connect account is attached, never duplicated; a new
 * address gets an account with no password — the invite link is where they set one.
 * Seat limits come from the plan and are enforced here, server-side (§28).
 */
export async function inviteMember(tenantId: string, input: InviteInput) {
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
		throw new AppError('VALIDATION_ERROR', 'Enter a valid email address.');
	// Owner/platform roles are never grantable through an invitation (§12, §27).
	if (!INVITABLE_ROLES.includes(input.role))
		throw new AppError('VALIDATION_ERROR', 'That role cannot be assigned by invitation.');

	// Plan seat limit: count every non-disabled seat, invited ones included.
	const seatLimit = await getLimit(tenantId, 'platform.maxUsers');
	if (seatLimit > 0) {
		const [{ value: seats }] = await db()
			.select({ value: count() })
			.from(schema.tenantMemberships)
			.where(and(eq(schema.tenantMemberships.tenantId, tenantId), isNull(schema.tenantMemberships.disabledAt)));
		if (Number(seats) >= seatLimit) {
			throw new AppError(
				'ENTITLEMENT_LIMIT_REACHED',
				`Your plan includes ${seatLimit} team member${seatLimit === 1 ? '' : 's'}. Upgrade to invite more.`,
				{ feature: 'platform.maxUsers', limit: seatLimit, usage: Number(seats) }
			);
		}
	}

	// Attach the existing account if there is one; otherwise create a password-less
	// account the invite link completes. Never a duplicate.
	let [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
	if (!user) {
		[user] = await db()
			.insert(schema.users)
			.values({ email, fullName: input.fullName.trim(), passwordHash: null })
			.returning();
	}

	const [existing] = await db()
		.select()
		.from(schema.tenantMemberships)
		.where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, user.id)))
		.limit(1);
	if (existing && !existing.disabledAt) throw new AppError('CONFLICT', 'That person is already on the team.');
	if (existing) {
		// Re-inviting a deactivated member reactivates the seat with the new role.
		await db()
			.update(schema.tenantMemberships)
			.set({
				role: input.role,
				disabledAt: null,
				acceptedAt: null,
				invitedByUserId: input.invitedByUserId,
				permissionOverrides: {},
				updatedAt: new Date()
			})
			.where(eq(schema.tenantMemberships.id, existing.id));
	} else {
		await db().insert(schema.tenantMemberships).values({
			tenantId,
			userId: user.id,
			role: input.role,
			invitedByUserId: input.invitedByUserId,
			acceptedAt: null
		});
	}

	// Single-use, expiring, tenant-bound invite token (§2).
	const { token } = await issueToken(user.id, 'TEAM_INVITE', null, tenantId);
	const tenant = await getTenantById(tenantId);
	const base = env().PUBLIC_APP_URL.replace(/\/+$/, '');
	const link = `${base}/accept-invite?token=${encodeURIComponent(token)}`;
	await enqueue('email.send', {
		to: email,
		subject: `You've been invited to ${tenant?.name ?? 'a team'} on Makutano Connect`,
		text: `${tenant?.name ?? 'A business'} invited you to join their team on Makutano Connect as ${roleLabel(input.role)}.\n\nAccept the invitation:\n${link}\n\nThis link expires in 7 days and can only be used once.`,
		html: `<p><b>${tenant?.name ?? 'A business'}</b> invited you to join their team on Makutano Connect as <b>${roleLabel(input.role)}</b>.</p><p><a href="${link}">Accept the invitation</a></p><p style="color:#94a3b8;font-size:12px">This link expires in 7 days and can only be used once.</p>`
	});

	await audit(
		tenantId,
		'user.invited',
		{ type: 'user', userId: input.invitedByUserId },
		{ type: 'user', id: user.id },
		{
			email,
			role: input.role
		}
	);
	log.info('team_member_invited', { tenantId, role: input.role });
	// The link comes back to the caller as well as going out by email.
	//
	// Email is the wrong and only channel for half the people this invites: a
	// safari driver in Arusha has WhatsApp, not an inbox he checks — and a
	// deployment with no mail provider configured drops the invite entirely
	// (sendEmail withholds the body from production logs on purpose, so it is
	// not recoverable afterwards). Handing the link back lets whoever issued the
	// invite pass it on however they actually reach that person.
	return { userId: user.id, inviteLink: link, emailed: emailReady() };
}

/* --------------------------------------------------------------- mutations ---- */

export async function changeRole(tenantId: string, membershipId: string, role: schema.Role, actor: { userId: string }) {
	if (!INVITABLE_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', 'That role cannot be assigned here.');
	const target = await membershipOf(tenantId, membershipId);
	if (target.membership.role === 'OWNER' && (await isLastActiveOwner(tenantId, membershipId))) {
		throw new AppError('CONFLICT', 'This is the only owner — transfer ownership before changing their role.');
	}
	await db()
		.update(schema.tenantMemberships)
		.set({ role, permissionOverrides: {}, updatedAt: new Date() })
		.where(eq(schema.tenantMemberships.id, membershipId));
	await audit(
		tenantId,
		'role.changed',
		{ type: 'user', userId: actor.userId },
		{ type: 'user', id: target.user.id },
		{
			from: target.membership.role,
			to: role
		}
	);
}

export async function setPermissionOverrides(
	tenantId: string,
	membershipId: string,
	overrides: Record<string, boolean>,
	actor: { userId: string }
) {
	const target = await membershipOf(tenantId, membershipId);
	if (target.membership.role === 'OWNER') {
		throw new AppError('VALIDATION_ERROR', 'Owner permissions cannot be customised — owners always have full access.');
	}
	// Store ONLY keys that differ from the role's defaults: the editor posts a full
	// snapshot, but persisting it verbatim would pin every permission and stop role
	// changes flowing through. Unknown keys are dropped rather than stored.
	const defaults = new Set(permissionsForRole(target.membership.role));
	const clean: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(overrides)) {
		if (!(PERMISSIONS as readonly string[]).includes(key)) continue;
		if (!!value !== defaults.has(key as Permission)) clean[key] = !!value;
	}
	await db()
		.update(schema.tenantMemberships)
		.set({ permissionOverrides: clean, updatedAt: new Date() })
		.where(eq(schema.tenantMemberships.id, membershipId));
	await audit(
		tenantId,
		'permission.changed',
		{ type: 'user', userId: actor.userId },
		{ type: 'user', id: target.user.id },
		{
			role: target.membership.role,
			before: target.membership.permissionOverrides ?? {},
			after: clean
		}
	);
}

export async function resetPermissions(tenantId: string, membershipId: string, actor: { userId: string }) {
	await setPermissionOverrides(tenantId, membershipId, {}, actor);
}

export async function setMemberActive(
	tenantId: string,
	membershipId: string,
	active: boolean,
	actor: { userId: string },
	options: { reassignToUserId?: string | null } = {}
) {
	const target = await membershipOf(tenantId, membershipId);
	if (!active && (await isLastActiveOwner(tenantId, membershipId))) {
		throw new AppError('CONFLICT', 'You cannot deactivate the only owner.');
	}
	await db()
		.update(schema.tenantMemberships)
		.set({ disabledAt: active ? null : new Date(), updatedAt: new Date() })
		.where(eq(schema.tenantMemberships.id, membershipId));

	if (!active) {
		// Their sessions for THIS tenant lose access immediately via the membership
		// filter; sessions parked on this tenant get unparked so other tenants work.
		await db()
			.update(schema.sessions)
			.set({ activeTenantId: null })
			.where(and(eq(schema.sessions.userId, target.user.id), eq(schema.sessions.activeTenantId, tenantId)));
		// Hand their open conversations to someone else, or back to the team pool.
		await db()
			.update(schema.conversations)
			.set({ assignedToUserId: options.reassignToUserId ?? null, updatedAt: new Date() })
			.where(
				and(
					eq(schema.conversations.tenantId, tenantId),
					eq(schema.conversations.assignedToUserId, target.user.id),
					eq(schema.conversations.isOpen, true)
				)
			);
	}
	await audit(
		tenantId,
		active ? 'user.reactivated' : 'user.deactivated',
		{ type: 'user', userId: actor.userId },
		{ type: 'user', id: target.user.id },
		{ reassignedTo: options.reassignToUserId ?? null }
	);
}

/** Remove the seat. History (messages, audit rows) keeps the user reference (§25). */
export async function removeMember(tenantId: string, membershipId: string, actor: { userId: string }) {
	const target = await membershipOf(tenantId, membershipId);
	if (await isLastActiveOwner(tenantId, membershipId)) {
		throw new AppError('CONFLICT', 'You cannot remove the only owner.');
	}
	await db()
		.update(schema.sessions)
		.set({ activeTenantId: null })
		.where(and(eq(schema.sessions.userId, target.user.id), eq(schema.sessions.activeTenantId, tenantId)));
	await db()
		.update(schema.conversations)
		.set({ assignedToUserId: null, updatedAt: new Date() })
		.where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.assignedToUserId, target.user.id)));
	await db().delete(schema.tenantMemberships).where(eq(schema.tenantMemberships.id, membershipId));
	await audit(
		tenantId,
		'user.removed',
		{ type: 'user', userId: actor.userId },
		{ type: 'user', id: target.user.id },
		{
			email: target.user.email,
			role: target.membership.role
		}
	);
}
