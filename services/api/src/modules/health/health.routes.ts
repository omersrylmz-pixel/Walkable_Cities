import type { FastifyPluginAsync } from 'fastify';

import type { AppEnv } from '../../config/env.js';
import { pingDatabase } from '../../db/pool.js';
import type { Pool } from '../../db/pool.js';
import type { StorageAdapter } from '../../storage/types.js';

export interface HealthRoutesOptions {
  env: AppEnv;
  db: Pool | null;
  storage: StorageAdapter;
}

const AI_PROBE_TIMEOUT_MS = 2_000;

interface DependencyStatus {
  status: 'ok' | 'error' | 'not_configured';
  detail?: string;
  latencyMs?: number;
}

/**
 * Sağlık uçları.
 * - `/health`: süreç ayakta mı (liveness)
 * - `/health/ready`: PostgreSQL ve AI servisi gerçekten erişilebilir mi (readiness)
 */
export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, opts) => {
  const startedAt = Date.now();

  app.get('/', async () => ({
    status: 'ok',
    service: 'api',
    version: app.appVersion ?? '0.1.0',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    environment: opts.env.NODE_ENV,
  }));

  app.get('/ready', async (_request, reply) => {
    const database = await probeDatabase(opts.db);
    const aiService = await probeAiService(opts.env.AI_SERVICE_URL);

    // Veritabanı zorunlu bağımlılık; AI servisi geçici olarak erişilemezse
    // ihbarlar kuyrukta bekleyebilir, bu yüzden 200 + "degraded" döneriz.
    const ready = database.status === 'ok';
    const status = !ready ? 'not_ready' : aiService.status === 'ok' ? 'ready' : 'degraded';

    const dependencies: Record<string, DependencyStatus | Record<string, unknown>> = {
      database: {
        ...database,
        configured: Boolean(opts.db),
      },
      aiService: {
        url: opts.env.AI_SERVICE_URL,
        ...aiService,
      },
      storage: {
        driver: opts.storage.driver,
        status: 'ok',
      },
    };

    return reply.code(ready ? 200 : 503).send({
      status,
      timestamp: new Date().toISOString(),
      dependencies,
    });
  });

  app.get('/version', async () => ({
    name: 'yaya-alani-ihlal-api',
    version: app.appVersion ?? '0.1.0',
    node: process.version,
  }));
};

async function probeDatabase(db: Pool | null): Promise<DependencyStatus> {
  if (!db) {
    return { status: 'not_configured', detail: 'DATABASE_URL tanımlı değil' };
  }

  const start = Date.now();
  try {
    await pingDatabase(db);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : 'bilinmeyen hata',
    };
  }
}

async function probeAiService(baseUrl: string): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(AI_PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        detail: `HTTP ${response.status}`,
      };
    }

    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      detail: error instanceof Error ? error.message : 'AI servisine ulaşılamadı',
    };
  }
}
