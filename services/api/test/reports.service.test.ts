import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Anonymizer } from '../src/clients/privacy-client.js';
import type { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import { ReportsService } from '../src/modules/reports/reports.service.js';
import type { ReportDto } from '../src/modules/reports/reports.types.js';
import { EXIF_GPS_TOLERANCE_M } from '../src/shared/integrity.js';
import type { StorageAdapter } from '../src/storage/types.js';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const CLIENT_REPORT_ID = '3f5d1f9e-6f9f-4b3f-9d3b-6d1f9a2c4b7e';

function makeMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientReportId: CLIENT_REPORT_ID,
    violationType: 'kaldirim_isgali',
    capturedAt: '2026-03-15T11:58:00.000Z',
    location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5 },
    ...overrides,
  };
}

function makeReport(overrides: Partial<ReportDto> = {}): ReportDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clientReportId: CLIENT_REPORT_ID,
    violationType: 'kaldirim_isgali',
    violationLabel: 'Kaldırım İşgali',
    status: 'queued',
    decision: null,
    confidenceScore: null,
    severity: null,
    description: null,
    capturedAt: '2026-03-15T11:58:00.000Z',
    receivedAt: '2026-03-15T12:00:00.000Z',
    location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5, source: 'device' },
    h3: { cell: null, resolution: 9 },
    duplicateOf: null,
    duplicateScore: null,
    anonymizedAt: null,
    retentionExpiresAt: '2028-03-14T12:00:00.000Z',
    integrity: null,
    images: [],
    createdAt: '2026-03-15T12:00:00.000Z',
    updatedAt: '2026-03-15T12:00:00.000Z',
    ...overrides,
  };
}

function jpegBuffer(padding = 64): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(padding, 0x00)]);
}

interface Fakes {
  repo: ReportsRepository;
  storage: StorageAdapter & {
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function makeFakes(overrides: {
  findByClientReportId?: (...args: unknown[]) => Promise<ReportDto | null>;
  create?: (...args: unknown[]) => Promise<ReportDto>;
  findExactImageDuplicate?: (...args: unknown[]) => Promise<{ reportId: string } | null>;
  findNearDuplicate?: (...args: unknown[]) => Promise<{
    reportId: string;
    distanceM: number;
    ageSeconds: number;
  } | null>;
} = {}): Fakes {
  const repo = {
    findByClientReportId: vi.fn(overrides.findByClientReportId ?? (async () => null)),
    findById: vi.fn(async () => null),
    list: vi.fn(async () => ({ items: [], total: 0, limit: 20, offset: 0 })),
    create: vi.fn(overrides.create ?? (async () => makeReport())),
    findExactImageDuplicate: vi.fn(overrides.findExactImageDuplicate ?? (async () => null)),
    findNearDuplicate: vi.fn(overrides.findNearDuplicate ?? (async () => null)),
    getImage: vi.fn(async () => null),
    getViolationTypes: vi.fn(async () => []),
    getThresholds: vi.fn(async () => ({ autoAccept: 0.85, manualReview: 0.6 })),
  } as unknown as ReportsRepository;

  const storage = {
    driver: 'local' as const,
    put: vi.fn(async (input: { key: string; body: Buffer; contentType: string }) => ({
      key: input.key,
      byteSize: input.body.byteLength,
      contentType: input.contentType,
    })),
    get: vi.fn(async () => ({ body: Buffer.from(''), contentType: 'image/jpeg' })),
    delete: vi.fn(async () => undefined),
  };

  return { repo, storage: storage as unknown as Fakes['storage'] };
}

function makeService(
  fakes: Fakes,
  maxUploadBytes = 12 * 1024 * 1024,
  options: {
    anonymizer?: Anonymizer;
    anonymizationRequired?: boolean;
    retentionDays?: number;
  } = {},
): ReportsService {
  return new ReportsService({
    repository: fakes.repo,
    storage: fakes.storage,
    maxUploadBytes,
    now: () => NOW,
    ...options,
  });
}

function makeAnonymizer(
  result: Awaited<ReturnType<Anonymizer['anonymize']>> | Error = {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mimeType: 'image/png',
    backend: 'heuristic',
    facesBlurred: 1,
    platesBlurred: 2,
    width: 320,
    height: 240,
  },
): Anonymizer {
  return {
    anonymize: vi.fn(async () => {
      if (result instanceof Error) {
        throw result;
      }
      return result;
    }),
  };
}

function validInput(buffer: Buffer = jpegBuffer()): {
  metadata: unknown;
  image: { buffer: Buffer; declaredMimeType: string };
} {
  return {
    metadata: makeMetadata(),
    image: { buffer, declaredMimeType: 'image/jpeg' },
  };
}

describe('ReportsService.createReport', () => {
  let fakes: Fakes;

  beforeEach(() => {
    fakes = makeFakes();
  });

  it('yeni ihbarı kaydeder ve görseli depolar', async () => {
    const service = makeService(fakes);
    const outcome = await service.createReport(validInput());

    expect(outcome.replayed).toBe(false);
    expect(fakes.storage.put).toHaveBeenCalledTimes(1);

    const putArg = fakes.storage.put.mock.calls[0]?.[0] as { key: string; contentType: string };
    expect(putArg.key).toMatch(/^reports\/2026\/03\/15\/[0-9a-f-]{36}\.jpg$/);
    expect(putArg.contentType).toBe('image/jpeg');

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      duplicateOf: string | null;
      duplicateScore: number | null;
      images: { kind: string; sha256: Buffer; mimeType: string; blurApplied: boolean }[];
      integrity: {
        exif: { present: boolean };
        anonymization: { status: string };
        checkedAt: string;
      };
      anonymizedAt: Date | null;
      retentionExpiresAt: Date;
    };
    expect(createArg.duplicateOf).toBeNull();
    expect(createArg.duplicateScore).toBeNull();
    expect(createArg.images).toHaveLength(1);
    expect(createArg.images[0]).toMatchObject({
      kind: 'original',
      mimeType: 'image/jpeg',
      blurApplied: false,
    });
    expect(createArg.images[0]?.sha256).toHaveLength(32);
    expect(createArg.integrity.exif.present).toBe(false);
    expect(createArg.integrity.anonymization.status).toBe('skipped');
    expect(createArg.integrity.checkedAt).toBe(NOW.toISOString());
    expect(createArg.anonymizedAt).toBeNull();
    expect(createArg.retentionExpiresAt.toISOString()).toBe('2028-03-14T12:00:00.000Z');
  });

  it('aynı clientReportId tekrar geldiğinde idempotent yanıt döner', async () => {
    const existing = makeReport({ id: '22222222-2222-4222-8222-222222222222' });
    fakes = makeFakes({ findByClientReportId: async () => existing });

    const service = makeService(fakes);
    const outcome = await service.createReport(validInput());

    expect(outcome.replayed).toBe(true);
    expect(outcome.report).toBe(existing);
    expect(fakes.storage.put).not.toHaveBeenCalled();
    expect(fakes.repo.create).not.toHaveBeenCalled();
  });

  it('birebir aynı görseli mükerrer olarak işaretler (skor 1)', async () => {
    fakes = makeFakes({
      findExactImageDuplicate: async () => ({ reportId: 'dup-report-id' }),
    });

    const service = makeService(fakes);
    await service.createReport(validInput());

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      duplicateOf: string | null;
      duplicateScore: number | null;
    };
    expect(createArg.duplicateOf).toBe('dup-report-id');
    expect(createArg.duplicateScore).toBe(1);
  });

  it('eşik üstü yakın konum/zaman eşleşmesini mükerrer sayar', async () => {
    fakes = makeFakes({
      findNearDuplicate: async () => ({ reportId: 'near-report-id', distanceM: 10, ageSeconds: 300 }),
    });

    const service = makeService(fakes);
    await service.createReport(validInput());

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      duplicateOf: string | null;
      duplicateScore: number | null;
    };
    expect(createArg.duplicateOf).toBe('near-report-id');
    expect(createArg.duplicateScore).toBeGreaterThanOrEqual(0.7);
  });

  it('eşik altı yakın eşleşmeyi mükerrer saymaz', async () => {
    fakes = makeFakes({
      findNearDuplicate: async () => ({
        reportId: 'far-report-id',
        distanceM: 70,
        ageSeconds: 5 * 3600,
      }),
    });

    const service = makeService(fakes);
    await service.createReport(validInput());

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      duplicateOf: string | null;
      duplicateScore: number | null;
    };
    expect(createArg.duplicateOf).toBeNull();
    expect(createArg.duplicateScore).toBeNull();
  });

  it('görsel türünü gerçek baytlardan doğrular', async () => {
    const service = makeService(fakes);

    await expect(
      service.createReport({
        metadata: makeMetadata(),
        image: { buffer: Buffer.from('bu bir gorsel degil'), declaredMimeType: 'image/jpeg' },
      }),
    ).rejects.toMatchObject({ statusCode: 415 });

    expect(fakes.storage.put).not.toHaveBeenCalled();
  });

  it('bildirilen MIME türü içerikle uyuşmazsa reddeder', async () => {
    const service = makeService(fakes);

    await expect(
      service.createReport({
        metadata: makeMetadata(),
        image: { buffer: jpegBuffer(), declaredMimeType: 'image/png' },
      }),
    ).rejects.toMatchObject({ statusCode: 415 });
  });

  it('boş görseli reddeder', async () => {
    const service = makeService(fakes);

    await expect(
      service.createReport({
        metadata: makeMetadata(),
        image: { buffer: Buffer.alloc(0), declaredMimeType: 'image/jpeg' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('boyut sınırını aşan görseli 413 ile reddeder', async () => {
    const service = makeService(fakes, 32);

    await expect(service.createReport(validInput())).rejects.toMatchObject({ statusCode: 413 });
  });

  it('DB yazımı başarısız olursa yüklenen görseli geri alır', async () => {
    fakes = makeFakes({
      create: async () => {
        throw new Error('db down');
      },
    });

    const service = makeService(fakes);

    await expect(service.createReport(validInput())).rejects.toThrow('db down');
    expect(fakes.storage.delete).toHaveBeenCalledTimes(1);
  });

  it('eşzamanlı unique ihlalinde mevcut kaydı döndürür', async () => {
    const raced = makeReport({ id: '33333333-3333-4333-8333-333333333333' });
    let lookups = 0;

    fakes = makeFakes({
      findByClientReportId: async () => {
        lookups += 1;
        return lookups === 1 ? null : raced;
      },
      create: async () => {
        throw Object.assign(new Error('duplicate key value'), { code: '23505' });
      },
    });

    const service = makeService(fakes);
    const outcome = await service.createReport(validInput());

    expect(outcome.replayed).toBe(true);
    expect(outcome.report.id).toBe(raced.id);
    expect(fakes.storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('ReportsService — KVKK ve EXIF', () => {
  let fakes: Fakes;

  beforeEach(() => {
    fakes = makeFakes();
  });

  it('orijinal ve anonim görseli birlikte kaydeder', async () => {
    const anonymizer = makeAnonymizer();
    const service = makeService(fakes, undefined, { anonymizer });

    await service.createReport(validInput());

    expect(fakes.storage.put).toHaveBeenCalledTimes(2);
    const keys = fakes.storage.put.mock.calls.map(
      (call) => (call[0] as { key: string; contentType: string }).key,
    );
    expect(keys[0]).toMatch(/\.jpg$/);
    expect(keys[1]).toMatch(/\.png$/);

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      images: {
        kind: string;
        mimeType: string;
        blurApplied: boolean;
        facesBlurred: number;
        platesBlurred: number;
        exifRemoved: boolean;
        width: number | null;
      }[];
      integrity: { anonymization: { status: string; backend: string | null } };
      anonymizedAt: Date | null;
    };

    expect(createArg.images).toHaveLength(2);
    expect(createArg.images[0]).toMatchObject({ kind: 'original', mimeType: 'image/jpeg' });
    expect(createArg.images[1]).toMatchObject({
      kind: 'anonymized',
      mimeType: 'image/png',
      blurApplied: true,
      facesBlurred: 1,
      platesBlurred: 2,
      exifRemoved: true,
      width: 320,
    });
    expect(createArg.integrity.anonymization).toMatchObject({
      status: 'applied',
      backend: 'heuristic',
    });
    expect(createArg.anonymizedAt).toEqual(NOW);
  });

  it('zorunlu anonimleştirme başarısızsa 503 döner ve kayıt yazılmaz', async () => {
    const anonymizer = makeAnonymizer(new Error('ai down'));
    const service = makeService(fakes, undefined, {
      anonymizer,
      anonymizationRequired: true,
    });

    await expect(service.createReport(validInput())).rejects.toMatchObject({
      statusCode: 503,
      code: 'ANONYMIZATION_FAILED',
    });

    expect(fakes.storage.put).not.toHaveBeenCalled();
    expect(fakes.repo.create).not.toHaveBeenCalled();
  });

  it('opsiyonel anonimleştirme hatasını integrity altında kaydeder', async () => {
    const anonymizer = makeAnonymizer(new Error('ai down'));
    const service = makeService(fakes, undefined, {
      anonymizer,
      anonymizationRequired: false,
    });

    await service.createReport(validInput());

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      images: unknown[];
      integrity: { anonymization: { status: string; error: string | null } };
      anonymizedAt: Date | null;
    };

    expect(createArg.images).toHaveLength(1);
    expect(createArg.integrity.anonymization.status).toBe('failed');
    expect(createArg.integrity.anonymization.error).toContain('ai down');
    expect(createArg.anonymizedAt).toBeNull();
  });

  it('DB hatasında orijinal ve anonim dosyayı birlikte siler', async () => {
    fakes = makeFakes({
      create: async () => {
        throw new Error('db down');
      },
    });
    const service = makeService(fakes, undefined, { anonymizer: makeAnonymizer() });

    await expect(service.createReport(validInput())).rejects.toThrow('db down');
    expect(fakes.storage.delete).toHaveBeenCalledTimes(2);
  });

  it('EXIF GPS ve zamanını istemci verisiyle karşılaştırır', async () => {
    const buffer = readFileSync(new URL('./fixtures/exif-sample.jpg', import.meta.url));
    const service = makeService(fakes);

    await service.createReport({
      metadata: makeMetadata({
        capturedAt: '2026-03-15T11:58:00+03:00',
        location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5 },
      }),
      image: { buffer, declaredMimeType: 'image/jpeg' },
    });

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      integrity: {
        exif: { present: boolean; make: string | null; capturedAt: string | null };
        checks: {
          gps: { status: string; difference: number | null };
          capturedAt: { status: string; difference: number | null };
        };
      };
    };

    expect(createArg.integrity.exif).toMatchObject({
      present: true,
      make: 'TestMake',
      capturedAt: '2026-03-15T11:58:00',
    });
    expect(createArg.integrity.checks.gps.status).toBe('match');
    expect(createArg.integrity.checks.gps.difference).toBeLessThan(10);
    expect(createArg.integrity.checks.capturedAt).toMatchObject({
      status: 'match',
      difference: 0,
    });
  });

  it('EXIF ile istemci konumu uyuşmazsa mismatch işaretler', async () => {
    const buffer = readFileSync(new URL('./fixtures/exif-sample.jpg', import.meta.url));
    const service = makeService(fakes);

    await service.createReport({
      metadata: makeMetadata({
        capturedAt: '2026-03-15T11:58:00+03:00',
        location: { latitude: 39.9334, longitude: 32.8597, accuracyM: 8.5 },
      }),
      image: { buffer, declaredMimeType: 'image/jpeg' },
    });

    const createArg = vi.mocked(fakes.repo.create).mock.calls[0]?.[0] as {
      integrity: { checks: { gps: { status: string; difference: number | null } } };
    };

    expect(createArg.integrity.checks.gps.status).toBe('mismatch');
    expect(createArg.integrity.checks.gps.difference).toBeGreaterThan(EXIF_GPS_TOLERANCE_M);
  });
});

describe('ReportsService sorguları', () => {
  it('bulunmayan ihbar için 404 hatası üretir', async () => {
    const fakes = makeFakes();
    const service = makeService(fakes);

    await expect(service.getReport('44444444-4444-4444-8444-444444444444')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
