import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecisionsRepository } from '../src/modules/decisions/decisions.repository.js';
import { DecisionsService } from '../src/modules/decisions/decisions.service.js';
import type {
  ApplyDecisionInput,
  AuditEntry,
  DecisionState,
} from '../src/modules/decisions/decisions.types.js';
import type { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import type { ReportDto } from '../src/modules/reports/reports.types.js';
import { AppError } from '../src/shared/errors.js';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-03-15T12:00:00.000Z');

function makeState(overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    id: REPORT_ID,
    status: 'pending_review',
    decision: 'manual_review',
    confidenceScore: 0.72,
    reviewedAt: null,
    reviewedBy: null,
    ...overrides,
  };
}

function makeReport(overrides: Partial<ReportDto> = {}): ReportDto {
  return {
    id: REPORT_ID,
    clientReportId: '3f5d1f9e-6f9f-4b3f-9d3b-6d1f9a2c4b7e',
    violationType: 'kaldirim_isgali',
    violationLabel: 'Kaldırım İşgali',
    status: 'approved',
    decision: 'manual_accept',
    confidenceScore: 0.72,
    severity: null,
    description: null,
    capturedAt: '2026-03-15T11:58:00.000Z',
    receivedAt: '2026-03-15T12:00:00.000Z',
    location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5, source: 'device' },
    h3: { cell: null, resolution: 9 },
    duplicateOf: null,
    duplicateScore: null,
    images: [],
    createdAt: '2026-03-15T12:00:00.000Z',
    updatedAt: '2026-03-15T12:05:00.000Z',
    ...overrides,
  };
}

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: '1',
    action: 'report.decision.manual',
    fromStatus: 'pending_review',
    toStatus: 'approved',
    actorId: ACTOR_ID,
    payload: {},
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeFakes(state: DecisionState | null = makeState()) {
  const repository = {
    findState: vi.fn(async () => state),
    applyDecision: vi.fn(async (input: ApplyDecisionInput) => makeAudit({ toStatus: input.status })),
    listAudit: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
  } as unknown as DecisionsRepository;

  const reportsRepository = {
    getThresholds: vi.fn(async () => ({ autoAccept: 0.85, manualReview: 0.6 })),
    findById: vi.fn(async () => makeReport()),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
  } as unknown as ReportsRepository;

  const service = new DecisionsService({
    repository,
    reportsRepository,
    now: () => NOW,
  });

  return { repository, reportsRepository, service };
}

describe('DecisionsService — eşikler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('eşikleri açılışta okur ve zaman damgasıyla raporlar', async () => {
    const { service } = makeFakes();

    await service.initialize();

    expect(service.getThresholds()).toEqual({
      autoAccept: 0.85,
      manualReview: 0.6,
      loadedAt: NOW.toISOString(),
    });
  });

  it('veritabanı eşikleri geçersizse açılışı reddeder', async () => {
    const { service, reportsRepository } = makeFakes();
    vi.mocked(reportsRepository.getThresholds).mockResolvedValueOnce({
      autoAccept: 0.5,
      manualReview: 0.8,
    });

    await expect(service.initialize()).rejects.toThrow(/manuel inceleme/i);
  });

  it('sınır skorlarını DB fonksiyonuyla aynı bantlara yerleştirir', async () => {
    const { service } = makeFakes();
    await service.initialize();

    expect(service.classify(0.85)).toBe('auto_accept');
    expect(service.classify(0.8499)).toBe('manual_review');
    expect(service.classify(0.6)).toBe('manual_review');
    expect(service.classify(0.5999)).toBe('auto_reject');
  });
});

describe('DecisionsService — inceleme kuyruğu', () => {
  it('yalnızca pending_review kayıtlarını skora göre ister', async () => {
    const { service, reportsRepository } = makeFakes();
    await service.initialize();

    const result = await service.listReviewQueue({
      violationType: 'kaldirim_isgali',
      minScore: 0.6,
      limit: 10,
      offset: 0,
    });

    expect(reportsRepository.list).toHaveBeenCalledWith({
      status: 'pending_review',
      violationType: 'kaldirim_isgali',
      minScore: 0.6,
      maxScore: undefined,
      sort: 'score',
      limit: 10,
      offset: 0,
    });
    expect(result.thresholds.autoAccept).toBe(0.85);
  });
});

describe('DecisionsService — manuel karar', () => {
  it('kabul kararını denetim kaydıyla birlikte yazar', async () => {
    const { service, repository } = makeFakes();
    await service.initialize();

    const result = await service.applyDecision({
      reportId: REPORT_ID,
      decision: 'manual_accept',
      note: '  Kaldırım tamamen kapatılmış  ',
      actorId: ACTOR_ID,
      override: false,
    });

    expect(repository.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: REPORT_ID,
        decision: 'manual_accept',
        status: 'approved',
        note: 'Kaldırım tamamen kapatılmış',
        actorId: ACTOR_ID,
        previousDecision: 'manual_review',
        previousStatus: 'pending_review',
        thresholds: { autoAccept: 0.85, manualReview: 0.6 },
      }),
    );
    expect(result.report.status).toBe('approved');
    expect(result.audit.action).toBe('report.decision.manual');
  });

  it('ret kararını rejected durumuna eşler', async () => {
    const { service, repository } = makeFakes();
    await service.initialize();

    await service.applyDecision({
      reportId: REPORT_ID,
      decision: 'manual_reject',
      note: null,
      actorId: null,
      override: false,
    });

    expect(repository.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'manual_reject', status: 'rejected' }),
    );
  });

  it('analizi tamamlanmamış kayda karar vermeyi reddeder', async () => {
    const { service } = makeFakes(makeState({ status: 'processing' }));
    await service.initialize();

    await expect(
      service.applyDecision({
        reportId: REPORT_ID,
        decision: 'manual_accept',
        note: null,
        actorId: null,
        override: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DECISION_NOT_ALLOWED' });
  });

  it('mevcut manuel kararı override olmadan değiştirmez', async () => {
    const { service } = makeFakes(
      makeState({ decision: 'manual_accept', status: 'approved' }),
    );
    await service.initialize();

    await expect(
      service.applyDecision({
        reportId: REPORT_ID,
        decision: 'manual_reject',
        note: null,
        actorId: null,
        override: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DECISION_ALREADY_FINAL' });
  });

  it('override ile manuel karar değiştirilebilir', async () => {
    const { service, repository } = makeFakes(
      makeState({ decision: 'manual_accept', status: 'approved' }),
    );
    await service.initialize();

    await service.applyDecision({
      reportId: REPORT_ID,
      decision: 'manual_reject',
      note: null,
      actorId: ACTOR_ID,
      override: true,
    });

    expect(repository.applyDecision).toHaveBeenCalledWith(
      expect.objectContaining({ override: true, previousDecision: 'manual_accept' }),
    );
  });

  it('aynı manuel kararı override olmadan tekrar yazmaz', async () => {
    const { service, repository } = makeFakes(
      makeState({ decision: 'manual_accept', status: 'approved' }),
    );
    await service.initialize();

    await expect(
      service.applyDecision({
        reportId: REPORT_ID,
        decision: 'manual_accept',
        note: null,
        actorId: null,
        override: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(repository.applyDecision).not.toHaveBeenCalled();
  });

  it('olmayan ihbar için 404 döner', async () => {
    const { service } = makeFakes(null);
    await service.initialize();

    const error = await service
      .applyDecision({
        reportId: REPORT_ID,
        decision: 'manual_accept',
        note: null,
        actorId: null,
        override: false,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 404 });
  });

  it('denetim listesinde olmayan ihbar için 404 döner', async () => {
    const { service } = makeFakes(null);
    await service.initialize();

    await expect(service.listAudit(REPORT_ID, 50, 0)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
