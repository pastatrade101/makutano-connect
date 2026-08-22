// Apply Drizzle migrations. Run with: npm run db:migrate
// Reads DATABASE_URL from the environment (load your .env first, e.g. `set -a; . ./.env`).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Migrations run over a DIRECT (session-mode) connection. On Supabase that is the
// port-5432 url, not the port-6543 transaction pooler: DDL and the migrator's advisory
// lock need a session that persists across statements.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('Set DIRECT_DATABASE_URL (preferred) or DATABASE_URL / SUPABASE_DB_URL.');
	process.exit(1);
}
if (/:6543\//.test(url) && !process.env.DIRECT_DATABASE_URL) {
	console.warn('⚠️  This looks like a transaction-pooler URL (port 6543). Migrations want the direct URL (port 5432).');
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
	await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
	console.log('Migrations applied.');
} catch (err) {
	console.error('Migration failed:', (err as Error).message);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
