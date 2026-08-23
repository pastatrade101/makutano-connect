// Single database handle for the whole app. postgres-js + Drizzle; the pool is created
// lazily so importing this module (in tests, in scripts) never opens a connection.
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

let sqlClient: postgres.Sql | null = null;
let database: Database | null = null;

export function sqlConnection(): postgres.Sql {
	if (!sqlClient) {
		const e = env();
		sqlClient = postgres(e.DATABASE_URL, {
			max: e.DB_POOL_MAX,
			idle_timeout: 30,
			connect_timeout: 15,
			prepare: false, // works with pgbouncer/supabase transaction pooling
			onnotice: () => {}
		});
	}
	return sqlClient;
}

export function db(): Database {
	if (!database) database = drizzle(sqlClient ?? sqlConnection(), { schema });
	return database;
}

/* ------------------------------------------------------- transactions ---- */

let txSqlClient: postgres.Sql | null = null;
let txDatabase: Database | null = null;
let warnedAboutPooler = false;

/**
 * Handle for multi-statement transactions. Use this — never db() — with .transaction().
 *
 * This is measured behaviour, not caution: running a transaction over Supabase's
 * TRANSACTION pooler (port 6543) leaves the pool permanently broken. A later, unrelated
 * write then waits forever for a connection while pg_stat_activity shows no server-side
 * work at all, so it does not even surface as a lock or a slow query — the app simply
 * stops responding. A transaction needs a session that survives between statements, so
 * it runs over DIRECT_DATABASE_URL (port 5432), exactly as migrations do.
 */
export function txConnection(): postgres.Sql {
	if (!txSqlClient) {
		const e = env();
		const direct = e.DIRECT_DATABASE_URL || e.DATABASE_URL;
		if (!e.DIRECT_DATABASE_URL && /:6543\//.test(e.DATABASE_URL) && !warnedAboutPooler) {
			warnedAboutPooler = true;
			console.warn(
				'[db] DIRECT_DATABASE_URL is not set and DATABASE_URL is a transaction pooler (port 6543). ' +
					'Transactional work (tenant provisioning) needs a session connection and will be unreliable.'
			);
		}
		txSqlClient = postgres(direct, {
			// Transactions are rare and short. A small pool keeps session connections,
			// which are the scarcer resource, from being tied up by this path.
			max: 3,
			idle_timeout: 20,
			connect_timeout: 15,
			prepare: false,
			onnotice: () => {}
		});
	}
	return txSqlClient;
}

export function txDb(): Database {
	if (!txDatabase) txDatabase = drizzle(txSqlClient ?? txConnection(), { schema });
	return txDatabase;
}

export async function closeDb(): Promise<void> {
	if (sqlClient) await sqlClient.end({ timeout: 5 });
	if (txSqlClient) await txSqlClient.end({ timeout: 5 });
	sqlClient = null;
	database = null;
	txSqlClient = null;
	txDatabase = null;
}

export { schema };
