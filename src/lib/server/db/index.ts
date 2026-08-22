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

export async function closeDb(): Promise<void> {
	if (sqlClient) await sqlClient.end({ timeout: 5 });
	sqlClient = null;
	database = null;
}

export { schema };
