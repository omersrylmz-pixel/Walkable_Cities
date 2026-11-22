import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { AppContext } from '../src/context.js';
import type { Pool } from '../src/db/pool.js';
import type { DecisionsService } from '../src/modules/decisions/decisions.service.js';
import type { ReportsService } from '../src/modules/reports/reports.service.js';
import type { ReportSummaryDto } from '../src/modules/reports/reports.types.js';
import { AppError } from '../src/shared/errors.js';
import type { StorageAdapter } from '../src/storage/types.js';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

const env = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_PORT: '3999',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGINS: 'http://localhost:8081',
});

function makeQueueItem(): ReportSummaryDto {
  return {
    id: REPORT_ID,
    clientReportId: '3f5d1f9e-6f9f-4b3f-9d3b-6d1f9a2c4b7e',
    violationType: 'kaldirim_isgali',
    violationLabel: 'Kaldırım İşgali',
    status: 'pending_review',
    decision: 'manual_review',
    confidenceScore: 0.72,
    severity: null,
    description: null,
    capturedAt: '2026-03-15T11:58:00.000Z',
    receivedAt: '2026-03-15T12:00:00.000Z',
    location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5, source: 'device' },
    h3: { cell: null, resolution: 9 },
    duplicateOf: null,
    duplicateScore: null,
    imageCount: 1,
    createdAt: '2026-03-15T12:00:00.000Z',
    updatedAt: '2026-03-15T12:00:00.000Z',
  };
}

function makeContext(decisions: DecisionsService): AppContext {
  const storage = {
    driver: 'local' as const,
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as StorageAdapter;

  return {
    env,
    db: { end: vi.fn(async () => undefined), query: vi.fn() } as unknown as Pool,
    storage,
    reports: {} as ReportsService,
    decisions,
  };
}

function makeDecisions(overrides: Partial<DecisionsService> = {}): DecisionsService {
  return {
    initialize: vi.fn(async () => undefined),
    getThresholds: vi.fn(() => ({
      autoAccept: 0.85,
      manualReview: 0.6,
      loadedAt: '2026-03-15T12:00:00.000Z',
    })),
    classify: vi.fn(),
    listReviewQueue: vi.fn(async () => ({
      items: [makeQueueItem()],
      total: 3,
      limit: 20,
      offset: 0,
      thresholds: { autoAccept: 0.85, manualReview: 0.6, loadedAt: null },
    })),
    applyDecision: vi.fn(async () => ({
      report: { id: REPORT_ID },
      audit: {
        id: '1',
        action: 'report.decision.manual',
        fromStatus: 'pending_review',
        toStatus: 'approved',
        actorId: ACTOR_ID,
        payload: {},
        createdAt: '2026-03-15T12:05:00.000Z',
      },
      thresholds: { autoAccept: 0.85, manualReview: 0.6, loadedAt: null },
    })),
    listAudit: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
    ...overrides,
  } as unknown as DecisionsService;
}

describe('Karar uçları', () => {
  let app: FastifyInstance;
  let decisions: DecisionsService;

  beforeEach(async () => {
    decisions = makeDecisions();
    app = await buildApp(env, { context: makeContext(decisions) });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('inceleme kuyruğunu eşiklerle döndürür', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/review-queue' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 3, limit: 20, offset: 0, hasMore: true });
    expect(body.thresholds.autoAccept).toBe(0.85);
  });

  it('kuyruk sorgusunu servise normalize ederek iletir', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/review-queue?violationType=kaldirim_isgali&minScore=0.6&limit=5',
    });

    expect(decisions.listReviewQueue).toHaveBeenCalledWith({
      violationType: 'kaldirim_isgali',
      minScore: 0.6,
      maxScore: undefined,
      limit: 5,
      offset: 0,
    });
  });

  it('minScore > maxScore olduğunda 422 döner', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/review-queue?minScore=0.9&maxScore=0.2',
    });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().code).toBe('VALIDATION_ERROR');
  });

  it('manuel kararı notu kırpılmış olarak uygular', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/reports/${REPORT_ID}/decision`,
      payload: {
        decision: 'manual_accept',
        note: '  Kaldırım kapatılmış  ',
        actorId: ACTOR_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(decisions.applyDecision).toHaveBeenCalledWith({
      reportId: REPORT_ID,
      decision: 'manual_accept',
      note: 'Kaldırım kapatılmış',
      actorId: ACTOR_ID,
      override: false,
    });
    expect(response.json().data.audit.action).toBe('report.decision.manual');
  });

  it('geçersiz karar değerini 422 ile reddeder', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/reports/${REPORT_ID}/decision`,
      payload: { decision: 'auto_accept' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('VALIDATION_ERROR');
    expect(decisions.applyDecision).not.toHaveBeenCalled();
  });

  it('bilinmeyen gövde alanını reddeder', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/reports/${REPORT_ID}/decision`,
      payload: { decision: 'manual_reject', karar: 'evet' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('geçersiz UUID için 422 döner', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/reports/gecersiz/decision',
      payload: { decision: 'manual_reject' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('servis çakışmasını RFC 7807 olarak taşır', async () => {
    decisions = makeDecisions({
      applyDecision: vi.fn(async () => {
        throw new AppError(409, 'DECISION_ALREADY_FINAL', 'Karar zaten verilmiş');
      }),
    });
    await app.close();

    app = await buildApp(env, { context: makeContext(decisions) });
    await app.ready();

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/reports/${REPORT_ID}/decision`,
      payload: { decision: 'manual_reject' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'DECISION_ALREADY_FINAL',
      title: expect.any(String),
    });
  });

  it('ihbarın denetim izini döndürür', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/reports/${REPORT_ID}/audit`,
    });

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(decisions.listAudit).mock.calls[0]).toEqual([REPORT_ID, 50, 0]);
    expect(response.json().pagination.hasMore).toBe(false);
  });
});
