import { it } from 'vitest';
import { db, schema, closeDb } from '../src/lib/server/db';
import { hashPassword } from '../src/lib/server/auth/password';
process.env.JOB_WORKER = 'off';
it('temporary super admin for diagnosis', async () => {
	const stamp = Date.now().toString(36);
	const pw = `Ad-${stamp}-Aa1!`;
	const [u] = await db().insert(schema.users)
		.values({ email: `diag-${stamp}@example.com`, fullName: 'Diagnostic Admin', emailVerifiedAt: new Date(), passwordHash: await hashPassword(pw), isSuperAdmin: true })
		.returning();
	console.log(JSON.stringify({ email: u.email, pw }));
	await closeDb();
}, 120000);
