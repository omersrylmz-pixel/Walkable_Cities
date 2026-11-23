import { PrivacyClient } from './clients/privacy-client.js';
import type { AppEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import type { Pool } from './db/pool.js';
import { PgDecisionsRepository } from './modules/decisions/decisions.repository.js';
import { DecisionsService } from './modules/decisions/decisions.service.js';
import { PgReportsRepository } from './modules/reports/reports.repository.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { createStorage } from './storage/index.js';
import type { StorageAdapter } from './storage/types.js';

/**
 * Uygulama bağımlılıkları. `app.ts` yalnızca bu nesneyi tüketir; testler
 * sahte (fake) bağımlılıklarla aynı kablolamayı doğrulayabilir.
 */
export interface AppContext {
  env: AppEnv;
  db: Pool;
  storage: StorageAdapter;
  reports: ReportsService;
  decisions: DecisionsService;
}

export function createContext(env: AppEnv): AppContext {
  const db = createPool(env);
  const storage = createStorage(env);
  const repository = new PgReportsRepository(db);
  const anonymizer = env.ANONYMIZATION_ENABLED
    ? new PrivacyClient(env.AI_SERVICE_URL, env.ANONYMIZATION_TIMEOUT_MS)
    : undefined;

  return {
    env,
    db,
    storage,
    reports: new ReportsService({
      repository,
      storage,
      maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      anonymizer,
      anonymizationRequired: env.ANONYMIZATION_REQUIRED,
      retentionDays: env.RETENTION_DAYS,
    }),
    decisions: new DecisionsService({
      repository: new PgDecisionsRepository(db),
      reportsRepository: repository,
    }),
  };
}
