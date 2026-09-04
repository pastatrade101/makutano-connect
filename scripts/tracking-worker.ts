/**
 * The provisioning worker.
 *
 * Same repository, same image, different process and — critically — a different
 * environment: this is the only place the privileged tracking credential is
 * ever set. The web container cannot create a device even if asked to.
 *
 *   docker compose run --rm -e TRACCAR_ADMIN_USERNAME=... -e TRACCAR_ADMIN_PASSWORD=... \
 *     connect node --experimental-strip-types scripts/tracking-worker.ts
 *
 * Runs one pass and exits by default, so a cron entry or a compose service with
 * a restart policy is the whole scheduler. `--loop` keeps it resident for local
 * work. Duplicate execution is safe: claiming is a conditional UPDATE, so two
 * runs cannot take the same row.
 */
import { runProvisioningPass } from '../src/lib/server/tracking/provisioning-worker';

const loop = process.argv.includes('--loop');
const intervalMs = Number(process.env.TRACKING_WORKER_INTERVAL_MS ?? 10_000);

async function once() {
	const started = Date.now();
	const result = await runProvisioningPass();
	// Bounded on purpose: one line per pass, and silent when there is nothing to
	// say, so a worker running every ten seconds cannot fill a disk.
	if (result.provisioned || result.expired || result.cleaned) {
		console.log(
			JSON.stringify({ event: 'tracking_worker_pass', ...result, ms: Date.now() - started })
		);
	}
}

async function main() {
	if (!loop) {
		await once();
		return;
	}
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			await once();
		} catch (err) {
			console.error(JSON.stringify({ event: 'tracking_worker_error', message: String(err).slice(0, 200) }));
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		// A missing credential must stop the worker loudly, not leave it quietly
		// provisioning nothing.
		console.error(String(err instanceof Error ? err.message : err));
		process.exit(1);
	});
