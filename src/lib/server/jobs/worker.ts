// In-process job worker. Started once from hooks.server.ts; safe to run on every
// instance because claim() uses `for update skip locked`.
import { env } from '../env';
import { log } from '../logger';
import { claim, enqueue, requeueStalled, reschedule, succeed } from './queue';
import { handlers } from './handlers';

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
	const jobs = await claim(5);
	for (const job of jobs) {
		const handler = handlers[job.kind];
		if (!handler) {
			await reschedule(job, new Error(`No handler registered for job kind "${job.kind}"`));
			continue;
		}
		try {
			await handler((job.payload ?? {}) as Record<string, unknown>, job);
			await succeed(job.id);
			log.debug('job_done', { kind: job.kind, jobId: job.id });
		} catch (err) {
			await reschedule(job, err);
		}
	}
}

/** Idempotent: repeated calls (HMR, multiple imports) start exactly one loop. */
export function startWorker(): void {
	if (running) return;
	const e = env();
	if (e.JOB_WORKER !== 'on') {
		log.info('job_worker_disabled');
		return;
	}
	running = true;
	log.info('job_worker_started', { pollMs: e.JOB_POLL_MS });

	let sweepCounter = 0;
	const loop = async () => {
		try {
			await tick();
			// Every ~5 minutes: recover crashed jobs and run housekeeping.
			if (++sweepCounter * e.JOB_POLL_MS >= 300_000) {
				sweepCounter = 0;
				const requeued = await requeueStalled();
				if (requeued) log.warn('jobs_requeued', { count: requeued });
				await enqueue('maintenance.cleanup', {}, { dedupeKey: `cleanup:${Math.floor(Date.now() / 3_600_000)}` });
			}
		} catch (err) {
			log.error('job_worker_tick_failed', { error: (err as Error)?.message });
		} finally {
			timer = setTimeout(loop, e.JOB_POLL_MS);
			timer.unref?.();
		}
	};
	timer = setTimeout(loop, e.JOB_POLL_MS);
	timer.unref?.();
}

export function stopWorker(): void {
	if (timer) clearTimeout(timer);
	timer = null;
	running = false;
}
