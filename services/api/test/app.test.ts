import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import type { Pool } from '../src/db/pool.js';
import type { DecisionsRepository } from '../src/modules/decisions/decisions.repository.js';
import { DecisionsService } from '../src/modules/decisions/decisions.service.js';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import type { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import type { StorageAdapter } from '../src/storage/types.js';

const env = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_PORT: '3999',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGINS: 'http://localhost:8081',
});

function makeContext(): AppContext {
  const repository = {
    findByClientReportId: vi.fn(async () => null),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    create: vi.fn(),
    findExactImageDuplicate: vi.fn(async () => null),
    findNearDuplicate: vi.fn(async () => null),
    getImage: vi.fn(async () => null),
    getViolationTypes: vi.fn(async () => [
      {
        code: 'kaldirim_isgali',
        labelTr: 'Kaldırım İşgali',
        description: null,
        defaultSeverity: 4,
      },
    ]),
    getThresholds: vi.fn(async () => ({ autoAccept: 0.85, manualReview: 0.6 })),
  } as unknown as ReportsRepository;

  const storage = {
    driver: 'local' as const,
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as StorageAdapter;

  const db = { end: vi.fn(async () => undefined), query: vi.fn() } as unknown as Pool;

  const decisionsRepository = {
    findState: vi.fn(async () => null),
    applyDecision: vi.fn(),
    listAudit: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
  } as unknown as DecisionsRepository;

  const reports = new ReportsService({ repository, storage, maxUploadBytes: 1024 });

  return {
    env,
    db,
    storage,
    reports,
    decisions: new DecisionsService({
      repository: decisionsRepository,
      reportsRepository: repository,
      now: () => new Date('2026-03-15T12:00:00.000Z'),
    }),
  };
}

describe('HTTP hata zarfları (RFC 7807)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(env, { context: makeContext() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('geçersiz UUID için 422 problem+json döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/reports/gecersiz-id' });
    const body = response.json();

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.traceId).toBeTruthy();
    expect(body.errors?.[0]?.path).toBe('id');
  });

  it('multipart olmayan ihbar isteğini 415 ile reddeder', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: { 'content-type': 'application/json' },
      payload: { hello: 'world' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(body.type).toContain('/UNSUPPORTED_MEDIA_TYPE');
  });

  it('bilinmeyen uç için 404 problem+json döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/bilinmeyen' });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(body.code).toBe('ROUTE_NOT_FOUND');
  });

  it('meta ucunda ihlal türlerini ve eşikleri döner', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/meta' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data.violationTypes).toHaveLength(1);
    expect(body.data.thresholds).toEqual({ autoAccept: 0.85, manualReview: 0.6 });
  });

  it('geçersiz liste parametresini 422 ile reddeder', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/reports?limit=500' });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });
});
