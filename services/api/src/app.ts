import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadEnv, parseCorsOrigins, type AppEnv } from './config/env.js';
import { createContext, type AppContext } from './context.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';

export const APP_VERSION = '0.1.0';

export interface BuildAppOptions {
  /** Testlerde sahte bağımlılık enjekte etmek için. */
  context?: AppContext;
}

/**
 * Uygulamayı yan etkisiz biçimde kurar (test edilebilirlik için).
 * Bağımlılıklar (DB havuzu, depolama, servisler) `AppContext` üzerinden gelir.
 */
export async function buildApp(
  env: AppEnv = loadEnv(),
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const context = options.context ?? createContext(env);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024, // JSON gövdeleri için; görseller multipart ile gelir.
    requestIdHeader: 'x-request-id',
  });

  app.decorate('appVersion', APP_VERSION);

  registerErrorHandler(app);
  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGINS),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
      files: 1,
      fields: 10,
      parts: 12,
    },
  });

  await app.register(healthRoutes, { prefix: '/health', env, db: context.db, storage: context.storage });
  await app.register(reportsRoutes, { prefix: '/v1', service: context.reports });

  app.get('/', async () => ({
    name: 'yaya-alani-ihlal-api',
    version: APP_VERSION,
    health: '/health',
    ready: '/health/ready',
    reports: '/v1/reports',
    meta: '/v1/meta',
  }));

  // Havuzu uygulama yaşam döngüsüne bağla.
  app.addHook('onClose', async () => {
    await context.db.end().catch(() => undefined);
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    appVersion: string;
  }
}
