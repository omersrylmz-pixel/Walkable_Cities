import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';

import { loadEnv, parseCorsOrigins, type AppEnv } from './config/env.js';
import { healthRoutes } from './modules/health/health.routes.js';

export const APP_VERSION = '0.1.0';

/**
 * Uygulamayı yan etkisiz biçimde kurar (test edilebilirlik için).
 * Faz 1'de buraya veritabanı, depolama ve AI istemcisi eklenecek.
 */
export async function buildApp(env: AppEnv = loadEnv()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
  });

  app.decorate('appVersion', APP_VERSION);

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: parseCorsOrigins(env.CORS_ORIGINS),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(healthRoutes, { prefix: '/health', env });

  app.get('/', async () => ({
    name: 'yaya-alani-ihlal-api',
    version: APP_VERSION,
    health: '/health',
    ready: '/health/ready',
  }));

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    appVersion: string;
  }
}
