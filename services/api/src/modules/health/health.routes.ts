import type { FastifyPluginAsync } from 'fastify';

import type { AppEnv } from '../../config/env.js';

export interface HealthRoutesOptions {
  env: AppEnv;
}

/**
 * Faz 0 sağlık uçları.
 * Faz 1'de `/health/ready` PostgreSQL ve AI servisi bağımlılıklarını gerçekten yoklayacak.
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
    const dependencies = {
      database: {
        configured: Boolean(opts.env.DATABASE_URL),
        status: opts.env.DATABASE_URL ? 'configured' : 'not_configured',
      },
      aiService: {
        url: opts.env.AI_SERVICE_URL,
        status: 'not_probed',
      },
      storage: {
        driver: opts.env.STORAGE_DRIVER,
        status: 'configured',
      },
    };

    const ready = dependencies.database.configured;

    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
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
