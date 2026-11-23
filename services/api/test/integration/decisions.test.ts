import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildExifImage,
  cleanupReport,
  createModerator,
  deleteUser,
  ensureStackReady,
  getJson,
  makeMetadata,
  promoteToPendingReview,
  sendJson,
  uploadReport,
} from './support/stack.js';

describe('Karar hattı — inceleme kuyruğu, manuel karar ve denetim izi', () => {
  let reportId = '';
  let actorId = '';
  let storagePaths: string[] = [];
  let thresholds: { autoAccept: number; manualReview: number };

  beforeAll(async () => {
    await ensureStackReady();

    actorId = await createModerator();

    const image = buildExifImage();
    const created = await uploadReport({
      image: image.buffer,
      metadata: makeMetadata(image.capturedAt, {
        location: { ...image.location, accuracyM: 8.5, source: 'device' },
        description: 'Entegrasyon: karar hattı',
      }),
    });

    if (created.status !== 201) {
      throw new Error(`İhbar oluşturulamadı (${created.status}): ${created.text}`);
    }

    reportId = created.body.data.id as string;
    storagePaths = (created.body.data.images as Array<{ storagePath: string }>).map(
      (image) => image.storagePath,
    );

    // AI skoru akışın dışında oluşur; burada DB tetikleyicisini çalıştırarak
    // kaydı manuel inceleme bandına (0.60 <= skor < 0.85) taşıyoruz.
    const promoted = await promoteToPendingReview(reportId, 0.72);
    thresholds = { autoAccept: 0.85, manualReview: 0.6 };

    expect(promoted).toEqual({ status: 'pending_review', decision: 'manual_review' });
  }, 120_000);

  afterAll(async () => {
    await cleanupReport(reportId, storagePaths);
    if (actorId) {
      await deleteUser(actorId);
    }
  });

  it('inceleme kuyruğunda kaydı eşiklerle birlikte döndürür', async () => {
    const response = await getJson(
      '/v1/review-queue?violationType=kaldirim_isgali&minScore=0.6&maxScore=0.84&limit=100',
    );

    expect(response.status, response.text).toBe(200);
    expect(response.body.thresholds).toMatchObject(thresholds);

    const item = (response.body.data as Array<Record<string, unknown>>).find(
      (entry) => entry.id === reportId,
    );
    expect(item, 'inceleme kuyruğunda test kaydı bulunamadı').toBeTruthy();
    expect(item).toMatchObject({
      status: 'pending_review',
      decision: 'manual_review',
      violationType: 'kaldirim_isgali',
    });
    expect(Number(item?.confidenceScore)).toBeCloseTo(0.72, 3);
    expect(Number(item?.imageCount)).toBe(2);
  });

  it('manuel kabul kararını denetim kaydıyla birlikte uygular', async () => {
    const response = await sendJson('PATCH', `/v1/reports/${reportId}/decision`, {
      decision: 'manual_accept',
      note: '  Kaldırımda park doğrulandı  ',
      actorId,
    });

    expect(response.status, response.text).toBe(200);

    const { report, audit, thresholds: snapshot } = response.body.data;
    expect(report).toMatchObject({ id: reportId, status: 'approved', decision: 'manual_accept' });
    expect(audit).toMatchObject({
      action: 'report.decision.manual',
      fromStatus: 'pending_review',
      toStatus: 'approved',
      actorId,
    });
    expect(snapshot).toMatchObject(thresholds);
  });

  it('denetim izini değiştirilemez kayıt olarak listeler', async () => {
    const response = await getJson(`/v1/reports/${reportId}/audit`);

    expect(response.status, response.text).toBe(200);

    const entries = response.body.data as Array<Record<string, any>>;
    // Durum geçişleri DB tetikleyicisiyle ayrıca kaydedilir; moderasyon
    // kararlarını `action` üzerinden ayıklıyoruz.
    expect(entries.some((entry) => entry.action === 'report.created')).toBe(true);
    expect(entries.some((entry) => entry.action === 'report.status_changed')).toBe(true);

    const manual = entries.filter((entry) => entry.action === 'report.decision.manual');
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({
      fromStatus: 'pending_review',
      toStatus: 'approved',
      actorId,
    });
    expect(manual[0]?.payload).toMatchObject({
      decision: 'manual_accept',
      previousDecision: 'manual_review',
      note: 'Kaldırımda park doğrulandı',
      override: false,
    });
    expect(manual[0]?.payload?.thresholds).toMatchObject(thresholds);
  });

  it('override olmadan ikinci manuel kararı 409 ile reddeder', async () => {
    const response = await sendJson('PATCH', `/v1/reports/${reportId}/decision`, {
      decision: 'manual_reject',
      actorId,
    });

    expect(response.status, response.text).toBe(409);
    expect(response.body).toMatchObject({
      status: 409,
      code: 'DECISION_ALREADY_FINAL',
    });

    const audit = await getJson(`/v1/reports/${reportId}/audit`);
    const manual = (audit.body.data as Array<Record<string, any>>).filter(
      (entry) => entry.action === 'report.decision.manual',
    );
    expect(manual).toHaveLength(1);

    const report = await getJson(`/v1/reports/${reportId}`);
    expect(report.body.data).toMatchObject({ status: 'approved', decision: 'manual_accept' });
  });

  it('override=true ile kararı değiştirir ve ikinci denetim kaydını yazar', async () => {
    const response = await sendJson('PATCH', `/v1/reports/${reportId}/decision`, {
      decision: 'manual_reject',
      note: 'Görsel eski tarihli',
      actorId,
      override: true,
    });

    expect(response.status, response.text).toBe(200);
    expect(response.body.data.report).toMatchObject({
      id: reportId,
      status: 'rejected',
      decision: 'manual_reject',
    });

    const audit = await getJson(`/v1/reports/${reportId}/audit`);
    const manual = (audit.body.data as Array<Record<string, any>>).filter(
      (entry) => entry.action === 'report.decision.manual',
    );
    expect(manual).toHaveLength(2);

    // Liste en yeniden eskiye sıralıdır.
    expect(manual[0]).toMatchObject({
      fromStatus: 'approved',
      toStatus: 'rejected',
      actorId,
    });
    expect(manual[0]?.payload).toMatchObject({
      decision: 'manual_reject',
      previousDecision: 'manual_accept',
      override: true,
    });
  });

  it('bilinmeyen ihbar için 404 döner', async () => {
    const response = await sendJson('PATCH', `/v1/reports/${randomUUID()}/decision`, {
      decision: 'manual_accept',
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
});
