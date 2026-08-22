// Postgres-backed job queue (§28). Chosen over Redis/BullMQ because the deployment
// already requires Postgres and nothing else: one fewer service to run, and jobs are
// transactional with the data that produced them.
//
// Claiming uses `for update skip locked`, so multiple app instances can run workers
// concurrently without ever handing the same job to two of them.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { log } from '../logger';

export type JobKind =
	| 'whatsapp.send'
	| 'whatsapp.webhook'
	| 'whatsapp.relay'
	| 'whatsapp.templates.sync'
	| 'whatsapp.token.health'
	| 'client_webhook.deliver'
	| 'notification.deliver'
	| 'email.send'
	| 'payment.reconcile'
	| 'usage.aggregate'
	| 'maintenance.cleanup';

export type EnqueueOptions = {
	tenantId?: string | null;
	runAt?: Date;
	maxAttempts?: number;
	/** Collapses duplicates — a second enqueue with the same key is a no-op. */
	dedupeKey?: string;
};

export async function enqueue(
	kind: JobKind,
	payload: Record<string, unknown> = {},
	options: EnqueueOptions = {}
): Promise<string | null> {
	const rows = await db()
		.insert(schema.jobs)
		.values({
			kind,
			payload,
			tenantId: options.tenantId ?? null,
			runAt: options.runAt ?? new Date(),
			maxAttempts: options.maxAttempts ?? 5,
			dedupeKey: options.dedupeKey ?? null
		})
		.onConflictDoNothing()
		.returning({ id: schema.jobs.id });

	const id = rows[0]?.id ?? null;
	if (!id) log.debug('job_deduped', { kind, dedupeKey: options.dedupeKey });
	return id;
}

/** Atomically claim up to `limit` due jobs for this worker. */
export async function claim(limit = 5): Promise<schema.Job[]> {
	const rows = (await db().execute(sql`
		with due as (
			select id from jobs
			where status = 'PENDING' and run_at <= now()
			order by run_at
			limit ${limit}
			for update skip locked
		)
		update jobs j
		set status = 'RUNNING', started_at = now(), attempts = j.attempts + 1
		from due
		where j.id = due.id
		returning j.*
	`)) as unknown as schema.Job[];
	return rows;
}

export async function succeed(jobId: string): Promise<void> {
	await db()
		.update(schema.jobs)
		.set({ status: 'SUCCEEDED', completedAt: new Date(), lastError: null })
		.where(eq(schema.jobs.id, jobId));
}

/** Reschedule with exponential backoff, or bury the job once attempts are exhausted. */
export async function reschedule(job: schema.Job, error: unknown): Promise<void> {
	const message = String((error as Error)?.message ?? error).slice(0, 1000);
	if (job.attempts >= job.maxAttempts) {
		await db()
			.update(schema.jobs)
			.set({ status: 'DEAD', lastError: message, completedAt: new Date() })
			.where(eq(schema.jobs.id, job.id));
		log.error('job_dead', { kind: job.kind, jobId: job.id, attempts: job.attempts, error: message });
		return;
	}
	const delayMs = Math.min(15 * 60_000, 2 ** job.attempts * 1000) + Math.floor(Math.random() * 500);
	await db()
		.update(schema.jobs)
		.set({ status: 'PENDING', runAt: new Date(Date.now() + delayMs), lastError: message })
		.where(eq(schema.jobs.id, job.id));
	log.warn('job_retry', { kind: job.kind, jobId: job.id, attempt: job.attempts, delayMs });
}

/** Release jobs stuck in RUNNING after a crash or redeploy. */
export async function requeueStalled(olderThanMinutes = 10): Promise<number> {
	const rows = await db()
		.update(schema.jobs)
		.set({ status: 'PENDING' })
		.where(
			and(
				eq(schema.jobs.status, 'RUNNING'),
				sql`${schema.jobs.startedAt} < now() - (${olderThanMinutes} || ' minutes')::interval`
			)
		)
		.returning({ id: schema.jobs.id });
	return rows.length;
}
