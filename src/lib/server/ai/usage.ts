// Metering for AI assist: who may spend, how much is left, and what was actually
// spent. Modelled on the same discipline as payments — a claim is not money, and an
// estimate is not a bill. These numbers exist so an operator is never surprised.
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { effectiveEntitlements } from '../entitlements';
import { AppError } from '../errors';
import { aiPlatformEnabled, estimateCostUsd, type TokenUsage } from './client';

export type AiFeature =
	'order_extraction' | 'tour_enquiry_extraction' | 'reply_draft' | 'conversation_summary' | 'triage';

/** What the human did with a suggestion — the metric that says whether AI actually
 *  saved anyone work (§30). Never used to score staff; it measures the product. */
export type AiOutcome = 'ACCEPTED' | 'EDITED' | 'DISCARDED';

/** UTC month start — the period every ceiling is counted against. */
function monthStart(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type AiAllowance = { used: number; limit: number; remaining: number | null };

/** Requests this tenant has already spent this month, successful or not. A failed
 *  call still consumed a request upstream, so counting only successes would let a
 *  broken prompt loop past any ceiling. */
export async function aiRequestsThisMonth(tenantId: string): Promise<number> {
	const rows = await db()
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.aiUsage)
		.where(and(eq(schema.aiUsage.tenantId, tenantId), gte(schema.aiUsage.createdAt, monthStart())));
	return Number(rows[0]?.n ?? 0);
}

/**
 * The gate every AI call passes through: the plan must include assist, and the
 * tenant must have monthly requests left. Returns the allowance so a caller can show
 * what remains. 0 as a limit means unlimited, matching every other entitlement.
 */
export async function assertAiAllowed(tenantId: string): Promise<AiAllowance> {
	// Platform kill switch (§46): stops every new model call across all tenants
	// without a deploy and without touching a single tenant's plan.
	if (!aiPlatformEnabled()) {
		throw new AppError('FEATURE_NOT_AVAILABLE', 'AI assist is temporarily unavailable.');
	}
	const entitlements = await effectiveEntitlements(tenantId);
	if (entitlements.resolved['ai.enabled']?.effective !== true) {
		throw new AppError('FEATURE_NOT_AVAILABLE', 'AI assist is not included in your current plan.');
	}
	const limit = Number(entitlements.resolved['ai.maxMonthlyRequests']?.effective ?? 0);
	const used = await aiRequestsThisMonth(tenantId);
	if (limit > 0 && used >= limit) {
		throw new AppError(
			'ENTITLEMENT_LIMIT_REACHED',
			`You have used all ${limit.toLocaleString()} AI requests included this month.`
		);
	}
	return { used, limit, remaining: limit > 0 ? Math.max(0, limit - used) : null };
}

/** Append to the ledger. Never throws into the caller's path — losing a usage row is
 *  bad, but failing a user's action because bookkeeping hiccuped is worse. */
export async function recordAiUsage(input: {
	tenantId: string;
	feature: AiFeature;
	model: string;
	usage: TokenUsage;
	ok: boolean;
	userId?: string | null;
	metadata?: Record<string, unknown>;
}): Promise<string | null> {
	try {
		const [row] = await db()
			.insert(schema.aiUsage)
			.values({
				tenantId: input.tenantId,
				feature: input.feature,
				model: input.model,
				inputTokens: input.usage.inputTokens,
				outputTokens: input.usage.outputTokens,
				cacheReadTokens: input.usage.cacheReadTokens,
				cacheWriteTokens: input.usage.cacheWriteTokens,
				costUsd: estimateCostUsd(input.model, input.usage).toFixed(6),
				ok: input.ok,
				userId: input.userId ?? null,
				metadata: input.metadata ?? {}
			})
			.returning({ id: schema.aiUsage.id });
		return row?.id ?? null;
	} catch {
		/* ledger write failed — the user's work still stands */
		return null;
	}
}

/**
 * Record what the human did with a suggestion. Scoped by tenant so one tenant can
 * never write outcomes onto another's ledger rows.
 */
export async function recordAiOutcome(tenantId: string, usageId: string, outcome: AiOutcome): Promise<void> {
	try {
		await db()
			.update(schema.aiUsage)
			.set({ outcome })
			.where(and(eq(schema.aiUsage.id, usageId), eq(schema.aiUsage.tenantId, tenantId)));
	} catch {
		/* a lost metric must never break the action it was measuring */
	}
}

/** Acceptance rates per feature — "did this save work?", not "who used it" (§30). */
export async function aiAcceptance(
	tenantId: string
): Promise<Array<{ feature: string; generated: number; accepted: number; edited: number; discarded: number }>> {
	const rows = (await db().execute(sql`
		select feature,
			count(*)::int as generated,
			count(*) filter (where outcome = 'ACCEPTED')::int as accepted,
			count(*) filter (where outcome = 'EDITED')::int as edited,
			count(*) filter (where outcome = 'DISCARDED')::int as discarded
		from ai_usage
		where tenant_id = ${tenantId}::uuid and ok = true and created_at >= date_trunc('month', now() at time zone 'utc')
		group by feature order by generated desc
	`)) as unknown as Array<{ feature: string; generated: number; accepted: number; edited: number; discarded: number }>;
	return rows.map((r) => ({
		feature: r.feature,
		generated: Number(r.generated),
		accepted: Number(r.accepted),
		edited: Number(r.edited),
		discarded: Number(r.discarded)
	}));
}

export type AiUsageSummary = { requests: number; costUsd: number; inputTokens: number; outputTokens: number };

/** This month's spend for one tenant — what the admin and the tenant both see. */
export async function aiUsageSummary(tenantId: string): Promise<AiUsageSummary> {
	const rows = await db()
		.select({
			requests: sql<number>`count(*)::int`,
			cost: sql<string>`coalesce(sum(${schema.aiUsage.costUsd}), 0)`,
			input: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}), 0)::int`,
			output: sql<number>`coalesce(sum(${schema.aiUsage.outputTokens}), 0)::int`
		})
		.from(schema.aiUsage)
		.where(and(eq(schema.aiUsage.tenantId, tenantId), gte(schema.aiUsage.createdAt, monthStart())));
	const row = rows[0];
	return {
		requests: Number(row?.requests ?? 0),
		costUsd: Number(row?.cost ?? 0),
		inputTokens: Number(row?.input ?? 0),
		outputTokens: Number(row?.output ?? 0)
	};
}
