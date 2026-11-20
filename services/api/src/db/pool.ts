import pg from 'pg';

import type { AppEnv } from '../config/env.js';

/**
 * Tek bir bağlantı havuzu oluşturur. Havuz yaşam döngüsü `app.close()` ile
 * sonlandırılır (bkz. src/app.ts).
 */
export function createPool(env: AppEnv): pg.Pool {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL tanımlı değil; PostgreSQL bağlantısı kurulamaz');
  }

  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'yaya-api',
  });
}

/** Hazırlık (readiness) kontrolü için hafif sorgu. */
export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('SELECT 1');
}

export type { Pool, PoolClient } from 'pg';
