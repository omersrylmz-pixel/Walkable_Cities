import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildExifImage,
  cleanupReport,
  closePool,
  countReportImages,
  ensureStackReady,
  expireRetention,
  getBinary,
  getJson,
  makeMetadata,
  runRetentionPurge,
  storageFileExists,
  uploadReport,
} from './support/stack.js';

describe('Saklama süresi temizliği — süresi dolan görseller silinir', () => {
  let reportId = '';
  let storagePaths: string[] = [];

  beforeAll(async () => {
    await ensureStackReady();

    const image = buildExifImage();
    const created = await uploadReport({
      image: image.buffer,
      metadata: makeMetadata(image.capturedAt, {
        location: { ...image.location, accuracyM: 8.5, source: 'device' },
        description: 'Entegrasyon: saklama temizliği',
      }),
    });

    if (created.status !== 201) {
      throw new Error(`İhbar oluşturulamadı (${created.status}): ${created.text}`);
    }

    reportId = created.body.data.id as string;
    storagePaths = (created.body.data.images as Array<{ storagePath: string }>).map(
      (image) => image.storagePath,
    );

    expect(storagePaths).toHaveLength(2);
    expect(await countReportImages(reportId)).toBe(2);

    // Saklama süresini geçmişe çek: temizlik işi bu kaydı hedeflemeli.
    await expireRetention(reportId);
  }, 120_000);

  afterAll(async () => {
    await cleanupReport(reportId, storagePaths);
    await closePool();
  });

  it('önce depolama nesnelerini, sonra DB görsel kayıtlarını siler', async () => {
    for (const storagePath of storagePaths) {
      expect(storageFileExists(storagePath)).toBe(true);
    }

    const result = runRetentionPurge();

    expect(Number(result.failed)).toBe(0);
    expect(Number(result.deleted)).toBeGreaterThanOrEqual(storagePaths.length);

    expect(await countReportImages(reportId)).toBe(0);
    for (const storagePath of storagePaths) {
      expect(storageFileExists(storagePath)).toBe(false);
    }
  }, 120_000);

  it('silinen görsellerin uçları 404 döner, ihbar metadatası korunur', async () => {
    const original = await getBinary(`/v1/reports/${reportId}/images/original`);
    expect(original.status).toBe(404);

    const anonymized = await getBinary(`/v1/reports/${reportId}/images/anonymized`);
    expect(anonymized.status).toBe(404);

    const report = await getJson(`/v1/reports/${reportId}`);
    expect(report.status).toBe(200);
    expect(report.body.data.images).toEqual([]);
    // Anonim istatistik kaydı (konum/zaman/karar) korunur.
    expect(report.body.data.anonymizedAt).toBeTruthy();
    expect(report.body.data.location.latitude).toBeCloseTo(41.0082, 4);
  });
});
