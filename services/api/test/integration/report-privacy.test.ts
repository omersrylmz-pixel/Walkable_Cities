import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildExifImage,
  cleanupReport,
  ensureStackReady,
  getBinary,
  getJson,
  getPool,
  makeMetadata,
  uploadReport,
  type ExifImage,
  type JsonResponse,
} from './support/stack.js';

interface TrackedReport {
  id: string;
  storagePaths: string[];
}

const tracked: TrackedReport[] = [];

function remember(response: JsonResponse): void {
  const data = response.body?.data;
  if (!data?.id || tracked.some((item) => item.id === data.id)) {
    return;
  }
  tracked.push({
    id: data.id as string,
    storagePaths: Array.isArray(data.images)
      ? data.images.map((image: { storagePath: string }) => image.storagePath)
      : [],
  });
}

describe('POST /v1/reports — KVKK ve EXIF (canlı yığın)', () => {
  let image: ExifImage;
  let metadata: ReturnType<typeof makeMetadata>;
  let created: JsonResponse;

  beforeAll(async () => {
    await ensureStackReady();

    image = buildExifImage();
    metadata = makeMetadata(image.capturedAt, {
      location: { ...image.location, accuracyM: 8.5, source: 'device' },
      description: 'Entegrasyon: EXIF + KVKK',
    });

    created = await uploadReport({ image: image.buffer, metadata });
    remember(created);
  }, 120_000);

  afterAll(async () => {
    for (const report of tracked) {
      await cleanupReport(report.id, report.storagePaths);
    }
  });

  it('ihbarı anonimleştirilmiş kopya ve EXIF doğrulamasıyla oluşturur', () => {
    expect(created.status, created.text).toBe(201);
    expect(created.headers.get('location')).toBe(`/v1/reports/${created.body.data.id}`);

    const report = created.body.data;
    // Skor, kayıtla birlikte yazıldığı için DB tetikleyicisi durumu hemen
    // otomatik karar bandına taşır; ihbar artık `queued` olarak kalmaz.
    expect(['auto_approved', 'pending_review', 'auto_rejected']).toContain(report.status);
    expect(Number(report.confidenceScore)).toBeGreaterThan(0);
    expect(Number(report.confidenceScore)).toBeLessThanOrEqual(1);
    expect(report.aiMetadata).toBeTruthy();
    expect(report.clientReportId).toBe(metadata.clientReportId);
    expect(report.anonymizedAt).toBeTruthy();

    const retentionDays =
      (new Date(report.retentionExpiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(retentionDays).toBeGreaterThan(725);
    expect(retentionDays).toBeLessThan(735);

    expect(report.integrity.exif).toMatchObject({
      present: true,
      make: 'TestMake',
      model: 'TestModel',
    });
    expect(report.integrity.exif.software).toMatch(/^WCT-/);

    const [exifDate, exifTime] = image.exifWallClock.split(' ');
    expect(report.integrity.exif.capturedAt).toBe(`${exifDate?.replaceAll(':', '-')}T${exifTime}`);

    expect(report.integrity.checks.gps.status).toBe('match');
    expect(report.integrity.checks.gps.tolerance).toBe(100);
    expect(report.integrity.checks.gps.difference).toBeLessThanOrEqual(100);

    expect(report.integrity.checks.capturedAt.status).toBe('match');
    expect(report.integrity.checks.capturedAt.tolerance).toBe(300);

    expect(report.integrity.anonymization).toMatchObject({
      status: 'applied',
      backend: 'heuristic',
      error: null,
    });
    expect(report.integrity.checkedAt).toBeTruthy();
  });

  it('değerlendirme tespitlerini ve eşiklerini JSONB olarak kalıcılaştırır', async () => {
    // Regresyon: `pg` sürücüsü JS dizilerini PostgreSQL dizi literal'i olarak
    // serileştirir. `detections` açıkça JSON.stringify edilmezse `$9::jsonb`
    // "22P02 Expected \":\", but found \",\"" hatası verir.
    const { rows } = await getPool().query<{
      detections: unknown;
      thresholds: unknown;
      outcome: string;
    }>(
      `SELECT detections, thresholds, outcome
         FROM report_evaluations
        WHERE report_id = $1`,
      [created.body.data.id],
    );

    expect(rows).toHaveLength(1);
    const evaluation = rows[0];
    expect(Array.isArray(evaluation?.detections)).toBe(true);
    expect(evaluation?.thresholds).toBeTypeOf('object');
    expect(evaluation?.thresholds).not.toBeNull();
    expect(Array.isArray(evaluation?.thresholds)).toBe(false);
    expect(evaluation?.outcome).toBeTruthy();

    const { rows: reportRows } = await getPool().query<{ ai_metadata: unknown }>(
      `SELECT ai_metadata FROM reports WHERE id = $1`,
      [created.body.data.id],
    );
    expect(reportRows[0]?.ai_metadata).toBeTypeOf('object');
    expect(Array.isArray(reportRows[0]?.ai_metadata)).toBe(false);
  });

  it('zaman aralığı filtresini sunucu tarafında uygular', async () => {
    const capturedAt = new Date(created.body.data.capturedAt).getTime();
    const before = new Date(capturedAt - 60_000).toISOString();
    const after = new Date(capturedAt + 60_000).toISOString();

    const inside = await getJson(
      `/v1/reports?from=${encodeURIComponent(before)}&to=${encodeURIComponent(after)}&limit=100`,
    );
    expect(inside.status, inside.text).toBe(200);
    expect(
      (inside.body.data as Array<{ id: string }>).some((item) => item.id === created.body.data.id),
    ).toBe(true);

    const outside = await getJson(`/v1/reports?from=${encodeURIComponent(after)}&limit=100`);
    expect(outside.status, outside.text).toBe(200);
    expect(
      (outside.body.data as Array<{ id: string }>).some((item) => item.id === created.body.data.id),
    ).toBe(false);
  });

  it('orijinal ve anonimleştirilmiş görselleri ayrı kayıt olarak döndürür', async () => {
    const images = created.body.data.images as Array<{
      kind: string;
      mimeType: string;
      byteSize: number | null;
      blurApplied: boolean;
      width: number | null;
      height: number | null;
    }>;

    expect(images).toHaveLength(2);

    const original = images.find((item) => item.kind === 'original');
    expect(original).toMatchObject({ mimeType: 'image/jpeg', blurApplied: false });
    expect(original?.byteSize).toBeGreaterThan(0);

    const anonymized = images.find((item) => item.kind === 'anonymized');
    expect(anonymized).toMatchObject({ mimeType: 'image/png', blurApplied: true });
    expect(anonymized?.width).toBeGreaterThan(0);
    expect(anonymized?.height).toBeGreaterThan(0);

    // `exifRemoved` DTO'da yer almaz; KVKK kaydını doğrudan DB'den doğrula.
    const { rows } = await getPool().query<{
      kind: string;
      blur_applied: boolean;
      exif_removed: boolean;
    }>(
      `SELECT kind, blur_applied, exif_removed
         FROM report_images
        WHERE report_id = $1
        ORDER BY kind`,
      [created.body.data.id],
    );

    expect(rows.find((row) => row.kind === 'original')).toMatchObject({
      blur_applied: false,
      exif_removed: false,
    });
    expect(rows.find((row) => row.kind === 'anonymized')).toMatchObject({
      blur_applied: true,
      exif_removed: true,
    });
  });

  it('orijinal görsel EXIF taşır, anonimleştirilmiş PNG taşımaz', async () => {
    const reportId = created.body.data.id as string;

    const original = await getBinary(`/v1/reports/${reportId}/images/original`);
    expect(original.status).toBe(200);
    expect(original.headers.get('content-type')).toContain('image/jpeg');
    expect(original.headers.get('cache-control')).toContain('no-store');
    expect(original.body.includes(Buffer.from('Exif'))).toBe(true);
    expect(original.body.includes(Buffer.from('TestMake'))).toBe(true);

    const anonymized = await getBinary(`/v1/reports/${reportId}/images/anonymized`);
    expect(anonymized.status).toBe(200);
    expect(anonymized.headers.get('content-type')).toContain('image/png');
    expect(anonymized.headers.get('cache-control')).toContain('no-store');

    // PNG imzası
    expect(anonymized.body.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(anonymized.body.includes(Buffer.from('Exif'))).toBe(false);
    expect(anonymized.body.includes(Buffer.from('TestMake'))).toBe(false);
    expect(anonymized.body.includes(Buffer.from('WalkableCities'))).toBe(false);
  });

  it('aynı clientReportId tekrar gönderilince idempotent 200 döner', async () => {
    const replay = await uploadReport({ image: image.buffer, metadata });
    remember(replay);

    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replay')).toBe('true');
    expect(replay.body.data.id).toBe(created.body.data.id);

    const fetched = await getJson(`/v1/reports/${created.body.data.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.images).toHaveLength(2);
  });

  it('aynı görsel farklı clientReportId ile yüklenince duplicate_of işaretlenir', async () => {
    const duo = buildExifImage();
    const sharedLocation = { latitude: 39.9334, longitude: 32.8597, accuracyM: 6, source: 'device' };

    const first = await uploadReport({
      image: duo.buffer,
      metadata: makeMetadata(duo.capturedAt, {
        violationType: 'sabit_engel',
        location: sharedLocation,
        description: 'Entegrasyon: mükerrer çifti (1)',
      }),
    });
    remember(first);

    const second = await uploadReport({
      image: duo.buffer,
      metadata: makeMetadata(duo.capturedAt, {
        violationType: 'sabit_engel',
        location: sharedLocation,
        description: 'Entegrasyon: mükerrer çifti (2)',
      }),
    });
    remember(second);

    expect(first.status, first.text).toBe(201);
    expect(second.status, second.text).toBe(201);

    expect(first.body.data.duplicateOf).toBeNull();
    expect(second.body.data.duplicateOf).toBe(first.body.data.id);
    expect(second.body.data.duplicateScore).toBe(1);
  });
});
