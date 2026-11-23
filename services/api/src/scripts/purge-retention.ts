/**
 * KVKK saklama süresi temizliği.
 *
 * Kullanım:
 *   npm run retention:purge            (geliştirme, tsx)
 *   node dist/scripts/purge-retention.js   (konteyner / üretim)
 *
 * Cron örneği (günlük 03:15):
 *   15 3 * * * docker compose exec -T api node dist/scripts/purge-retention.js
 */

import { loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PgRetentionRepository } from '../modules/retention/retention.repository.js';
import { RetentionService } from '../modules/retention/retention.service.js';
import { createStorage } from '../storage/index.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env);
  const logger = {
    info: (context: Record<string, unknown>, message: string) =>
      console.log(JSON.stringify({ level: 'info', message, ...context })),
    warn: (context: Record<string, unknown>, message: string) =>
      console.warn(JSON.stringify({ level: 'warn', message, ...context })),
  };

  try {
    const service = new RetentionService({
      repository: new PgRetentionRepository(pool),
      storage: createStorage(env),
      batchSize: env.RETENTION_PURGE_BATCH_SIZE,
      maxBatches: env.RETENTION_PURGE_MAX_BATCHES,
      logger,
    });

    const result = await service.purgeExpiredImages();
    console.log(JSON.stringify({ level: 'info', message: 'Saklama temizliği bitti', ...result }));

    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Saklama temizliği başarısız',
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
