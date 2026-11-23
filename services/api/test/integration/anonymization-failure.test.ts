import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildExifImage,
  closePool,
  countReportsByClientId,
  ensureStackReady,
  makeMetadata,
  startAiServiceAndWait,
  stopAiService,
  uploadReport,
} from './support/stack.js';

/**
 * Yıkıcı senaryo: AI konteyneri durdurulur. Test bitiminde (başarısız olsa
 * bile) yeniden başlatılır ve hazır olana kadar beklenir. Yığını paylaşan
 * ortamlarda `INTEGRATION_SKIP_DISRUPTIVE=1` ile atlanabilir.
 */
describe.skipIf(process.env.INTEGRATION_SKIP_DISRUPTIVE === '1')(
  'Anonimleştirme zorunlu — AI kapalıyken ihbar reddedilir',
  () => {
    let aiStopped = false;

    beforeAll(async () => {
      await ensureStackReady();
    }, 120_000);

    afterAll(async () => {
      try {
        if (aiStopped) {
          await startAiServiceAndWait();
        }
      } finally {
        await closePool();
      }
    }, 240_000);

    it('503 ANONYMIZATION_FAILED döner ve veritabanına kayıt yazmaz', async () => {
      stopAiService();
      aiStopped = true;

      const image = buildExifImage();
      const metadata = makeMetadata(image.capturedAt, {
        location: { ...image.location, accuracyM: 8.5, source: 'device' },
        description: 'Entegrasyon: AI kapalı',
      });

      const response = await uploadReport({ image: image.buffer, metadata });

      expect(response.status, response.text).toBe(503);
      expect(response.body).toMatchObject({
        status: 503,
        code: 'ANONYMIZATION_FAILED',
      });
      expect(String(response.body.detail)).toContain('anonimle');

      // KVKK gereği anonimlenmemiş kayıt hiç yazılmamalı.
      expect(await countReportsByClientId(metadata.clientReportId)).toBe(0);
    }, 120_000);
  },
);
