import { attachDatabasePool } from '@neon/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

// DATABASE_URL is injected by Neon Functions (pooled). Keep `max` small:
// the effective connection count is max × live isolates.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

export const db = drizzle(pool, { schema });
export type Db = typeof db;
