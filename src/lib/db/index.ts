import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL ?? 'postgres://localhost:5432/northstar';

const globalForSql = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export const sql =
  globalForSql.sql ??
  postgres(url, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 30,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForSql.sql = sql;
}

export const db = drizzle(sql, { schema });
