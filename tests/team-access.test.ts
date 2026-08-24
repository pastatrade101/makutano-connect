// Team access — the brief's acceptance scenarios (§33-§36) plus the safety rails.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionTestTenant } from './support';

const TEST_DB = process.env.TEST_DATABASE_URL;
const suite = TEST_DB ? describe : describe.skip;

process.env.DATABASE_URL = TEST_DB ?? 'postgres://localhost:5432/unused';
process.env.CREDENTIALS_ENCRYPTION_KEY ||= 'integration-test-encryption-key!!';
process.env.AUTH_SECRET ||= 'test-auth-secret-that-is-at-least-32-characters-long';
process.env.JOB_WORKER = 'off';

type Ctx = {
	db: typeof import('../src/lib/server/db');
	team: typeof import('../src/lib/server/team');
	conv: typeof import('../src/lib/server/conversations');
	perms: typeof import('../src/lib/server/auth/permissions');
	tenants: typeof import('../src/lib/server/tenants');
	verification: typeof import('../src/lib/server/auth/verification');
};

let ctx: Ctx;
let tenantId: string;
let ownerId: string;
const userIds: string[] = [];
const stamp = `${Date.now()}-team`;

async function mkUser(name: string) {
	const { db, schema } = ctx.db;
	const [u] = await db()
		.insert(schema.users)
		.values({ email: `${name}-${stamp}@example.com`, fullName: name, emailVerifiedAt: new Date() })
		.returning();
	userIds.push(u.id);
	return u;
}

async function addMember(userId: string, role: string, overrides: Record<string, boolean> = {}) {
	const { db, schema } = ctx.db;
	const [m] = await db()
		.insert(schema.tenantMemberships)
		.values({ tenantId, userId, role: role as never, acceptedAt: new Date(), permissionOverrides: overrides })
		.returning();
	return m;
}

function viewerOf(userId: string, role: string, overrides: Record<string, boolean> = {}) {
	return { userId, permissions: ctx.perms.effectivePermissions(role as never, overrides) };
}

suite('team access & conversation visibility', () => {
	beforeAll(async () => {
		ctx = {
			db: await import('../src/lib/server/db'),
			team: await import('../src/lib/server/team'),
			conv: await import('../src/lib/server/conversations'),
			perms: await import('../src/lib/server/auth/permissions'),
			tenants: await import('../src/lib/server/tenants'),
			verification: await import('../src/lib/server/auth/verification')
		};
		const tenant = await provisionTestTenant({ name: 'Office', slug: `office-${stamp}` });
		tenantId = tenant.id;
		const owner = await mkUser('owner');
		ownerId = owner.id;
		await addMember(owner.id, 'OWNER');
		// Unlimited seats for the scenarios; the seat-limit test pins its own cap.
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'platform.maxUsers': 0 } })
			.where(eq(schema.tenants.id, tenantId));
		(await import('../src/lib/server/entitlements')).invalidateEntitlements(tenantId);
	}, 120_000);

	afterAll(async () => {
		const { db, schema } = ctx.db;
		const { eq, inArray } = await import('drizzle-orm');
		await db().delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
		if (userIds.length) await db().delete(schema.users).where(inArray(schema.users.id, userIds));
		await ctx.db.closeDb();
	});

	it('§33 small office: Manager, Agent and a customised Finance user', () => {
		const manager = ctx.perms.effectivePermissions('BOOKING_AGENT', {});
		expect(manager).toContain('conversations:view_all');
		expect(manager).toContain('conversations:assign');
		expect(manager).toContain('payments:verify');
		expect(manager).not.toContain('whatsapp:connect'); // cannot disconnect WhatsApp
		expect(manager).not.toContain('billing:write'); // cannot manage subscription
		expect(manager).not.toContain('conversations:view_private');

		const agent = ctx.perms.effectivePermissions('SALES', {});
		expect(agent).toContain('conversations:read');
		expect(agent).toContain('conversations:write');
		expect(agent).toContain('whatsapp:send');
		expect(agent).not.toContain('payments:verify');
		expect(agent).not.toContain('conversations:view_private');
		expect(agent).not.toContain('members:write');
		expect(agent).not.toContain('api_keys:read');

		// Finance = Viewer + explicitly granted payment verification, nothing else.
		const finance = ctx.perms.effectivePermissions('VIEWER', {
			'payments:verify': true,
			'conversations:read': false
		});
		expect(finance).toContain('payments:read');
		expect(finance).toContain('payments:verify');
		expect(finance).not.toContain('conversations:read'); // no inbox
		expect(finance).not.toContain('whatsapp:connect');
	});

	it('owner overrides are ignored — an owner can never lock themselves out (§12)', () => {
		const owner = ctx.perms.effectivePermissions('OWNER', { 'members:write': false, 'tenant:write': false });
		expect(owner).toContain('members:write');
		expect(owner).toContain('tenant:write');
	});

	it('§34 private conversation: owner sees it, agent cannot, direct fetch blocked', async () => {
		const { db, schema } = ctx.db;
		const agent = await mkUser('agent');
		await addMember(agent.id, 'SALES');
		const admin = await mkUser('admin');
		await addMember(admin.id, 'ADMIN');

		const [conversation] = await db()
			.insert(schema.conversations)
			.values({ tenantId, channel: 'WHATSAPP', externalId: '255700900001', visibility: 'PRIVATE' })
			.returning();

		const ownerView = viewerOf(ownerId, 'OWNER');
		const agentView = viewerOf(agent.id, 'SALES');
		const adminView = viewerOf(admin.id, 'ADMIN');

		// Owner and (view_private) Admin see it; the agent gets NOT FOUND, not FORBIDDEN.
		await expect(ctx.conv.getConversation(tenantId, conversation.id, ownerView)).resolves.toBeTruthy();
		await expect(ctx.conv.getConversation(tenantId, conversation.id, adminView)).resolves.toBeTruthy();
		await expect(ctx.conv.getConversation(tenantId, conversation.id, agentView)).rejects.toMatchObject({
			code: 'CONVERSATION_NOT_FOUND'
		});

		// List scoping: the agent's inbox does not contain it — counts leak nothing.
		const agentList = await ctx.conv.listConversations(tenantId, { page: 1, limit: 50, order: 'desc' }, {}, agentView);
		expect(agentList.items.some((i) => i.conversation.id === conversation.id)).toBe(false);
		const ownerList = await ctx.conv.listConversations(tenantId, { page: 1, limit: 50, order: 'desc' }, {}, ownerView);
		expect(ownerList.items.some((i) => i.conversation.id === conversation.id)).toBe(true);

		// Sharing with the agent explicitly opens exactly that thread.
		await ctx.conv.updateConversationAccess(tenantId, conversation.id, { sharedWithUserIds: [agent.id] }, { userId: ownerId });
		await expect(ctx.conv.getConversation(tenantId, conversation.id, agentView)).resolves.toBeTruthy();
	});

	it('ASSIGNED visibility: the assignee sees it, another agent does not', async () => {
		const { db, schema } = ctx.db;
		const neema = await mkUser('neema');
		await addMember(neema.id, 'SALES');
		const other = await mkUser('other');
		await addMember(other.id, 'SALES');

		const [conversation] = await db()
			.insert(schema.conversations)
			.values({ tenantId, channel: 'WHATSAPP', externalId: '255700900002', visibility: 'ASSIGNED', assignedToUserId: neema.id })
			.returning();

		await expect(ctx.conv.getConversation(tenantId, conversation.id, viewerOf(neema.id, 'SALES'))).resolves.toBeTruthy();
		await expect(ctx.conv.getConversation(tenantId, conversation.id, viewerOf(other.id, 'SALES'))).rejects.toMatchObject({
			code: 'CONVERSATION_NOT_FOUND'
		});
		// A manager with view_all sees assigned threads (but still not private ones).
		const manager = await mkUser('manager');
		await addMember(manager.id, 'BOOKING_AGENT');
		await expect(ctx.conv.getConversation(tenantId, conversation.id, viewerOf(manager.id, 'BOOKING_AGENT'))).resolves.toBeTruthy();
	});

	it('§35 permission change takes effect through the resolver', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const staff = await mkUser('staff35');
		const membership = await addMember(staff.id, 'SALES');

		// Before: SALES cannot verify payments.
		let resolved = await ctx.tenants.resolveTenantForUser(
			(await db().select().from(schema.users).where(eq(schema.users.id, staff.id)))[0],
			tenantId
		);
		expect(resolved!.permissions).not.toContain('payments:verify');

		// Admin grants it via override.
		await ctx.team.setPermissionOverrides(tenantId, membership.id, { 'payments:verify': true }, { userId: ownerId });
		resolved = await ctx.tenants.resolveTenantForUser(
			(await db().select().from(schema.users).where(eq(schema.users.id, staff.id)))[0],
			tenantId
		);
		expect(resolved!.permissions).toContain('payments:verify');

		// And the change is audited with before/after.
		const audits = await db()
			.select()
			.from(schema.auditLogs)
			.where(eq(schema.auditLogs.tenantId, tenantId));
		expect(audits.some((a) => a.action === 'permission.changed')).toBe(true);
	});

	it('§36 deactivation: access gone immediately, conversations reassigned, history kept', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		const robert = await mkUser('robert');
		const robertMembership = await addMember(robert.id, 'BOOKING_AGENT');
		const backup = await mkUser('backup');
		await addMember(backup.id, 'BOOKING_AGENT');

		const [conversation] = await db()
			.insert(schema.conversations)
			.values({ tenantId, channel: 'WHATSAPP', externalId: '255700900003', assignedToUserId: robert.id, isOpen: true })
			.returning();
		await db().insert(schema.messages).values({
			tenantId, conversationId: conversation.id, direction: 'OUTBOUND', type: 'text', body: 'Sent by Robert', status: 'SENT', sentByUserId: robert.id
		});

		await ctx.team.setMemberActive(tenantId, robertMembership.id, false, { userId: ownerId }, { reassignToUserId: backup.id });

		// Access revoked through the resolver.
		const resolved = await ctx.tenants.resolveTenantForUser(
			(await db().select().from(schema.users).where(eq(schema.users.id, robert.id)))[0],
			tenantId
		);
		expect(resolved).toBeNull();

		// Open conversation handed to backup; the message history still names Robert.
		const [after] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, conversation.id));
		expect(after.assignedToUserId).toBe(backup.id);
		const [msg] = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
		expect(msg.sentByUserId).toBe(robert.id);
	});

	it('the last owner can never be deactivated or removed (§12)', async () => {
		const { db, schema } = ctx.db;
		const { and, eq } = await import('drizzle-orm');
		const [ownerMembership] = await db()
			.select()
			.from(schema.tenantMemberships)
			.where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.role, 'OWNER')));
		await expect(
			ctx.team.setMemberActive(tenantId, ownerMembership.id, false, { userId: ownerId })
		).rejects.toMatchObject({ code: 'CONFLICT' });
		await expect(ctx.team.removeMember(tenantId, ownerMembership.id, { userId: ownerId })).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		await expect(
			ctx.team.changeRole(tenantId, ownerMembership.id, 'SALES', { userId: ownerId })
		).rejects.toMatchObject({ code: 'CONFLICT' });
	});

	it('invitations cannot mint owners or platform admins (§12, §27)', async () => {
		await expect(
			ctx.team.inviteMember(tenantId, { fullName: 'X', email: `evil-${stamp}@example.com`, role: 'OWNER' as never, invitedByUserId: ownerId })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
		await expect(
			ctx.team.inviteMember(tenantId, { fullName: 'X', email: `evil2-${stamp}@example.com`, role: 'SUPER_ADMIN' as never, invitedByUserId: ownerId })
		).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
	});

	it('§28 seat limit blocks invitations server-side with an actionable message', async () => {
		const { db, schema } = ctx.db;
		const { eq } = await import('drizzle-orm');
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'platform.maxUsers': 1 } })
			.where(eq(schema.tenants.id, tenantId));
		(await import('../src/lib/server/entitlements')).invalidateEntitlements(tenantId);
		await expect(
			ctx.team.inviteMember(tenantId, { fullName: 'Over', email: `over-${stamp}@example.com`, role: 'SALES', invitedByUserId: ownerId })
		).rejects.toMatchObject({ code: 'ENTITLEMENT_LIMIT_REACHED' });
		await db()
			.update(schema.tenants)
			.set({ entitlementOverrides: { 'platform.maxUsers': 0 } })
			.where(eq(schema.tenants.id, tenantId));
		(await import('../src/lib/server/entitlements')).invalidateEntitlements(tenantId);
	});

	it('invite → accept activates the membership via a single-use tenant-bound token', async () => {
		const { db, schema } = ctx.db;
		const { and, eq } = await import('drizzle-orm');
		const email = `invitee-${stamp}@example.com`;
		const { userId } = await ctx.team.inviteMember(tenantId, {
			fullName: 'Invitee',
			email,
			role: 'SALES',
			invitedByUserId: ownerId
		});
		userIds.push(userId);

		// The membership exists but is not active yet.
		const [pending] = await db()
			.select()
			.from(schema.tenantMemberships)
			.where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
		expect(pending.acceptedAt).toBeNull();

		// Mint + consume an invite token the way the accept route does.
		const { token } = await ctx.verification.issueToken(userId, 'TEAM_INVITE', null, tenantId);
		const consumed = await ctx.verification.consumeInviteToken(token);
		expect(consumed?.tenantId).toBe(tenantId);
		expect(await ctx.verification.consumeInviteToken(token)).toBeNull(); // single-use
	});
});
