import { DatabaseSync } from 'node:sqlite';
import type { SqlDb, SqlValue } from '../src/services/localStore';

/** expo-sqlite's async API over Node's built-in SQLite, for tests. */
export function nodeSqlite(path = ':memory:'): SqlDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(path);
  return {
    raw,
    execAsync: async (sql: string) => raw.exec(sql),
    runAsync: async (sql: string, params: SqlValue[]) => raw.prepare(sql).run(...params),
    getAllAsync: async <T>(sql: string, params: SqlValue[]) => raw.prepare(sql).all(...params) as T[],
    closeAsync: async () => raw.close(),
  };
}
