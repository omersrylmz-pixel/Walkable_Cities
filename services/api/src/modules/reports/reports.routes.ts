import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { badRequest, unprocessable, unsupportedMedia } from '../../shared/errors.js';
import { LIST_SORTS, REPORT_STATUSES, VIOLATION_TYPES } from './reports.types.js';
import type { ReportsService } from './reports.service.js';

export interface ReportsRoutesOptions {
  service: ReportsService;
}

const MAX_METADATA_BYTES = 64 * 1024;

const listQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
  violationType: z.enum(VIOLATION_TYPES).optional(),
  sort: z.enum(LIST_SORTS).default('recent'),
  minScore: z.coerce.number().min(0).max(1).optional(),
  maxScore: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const paramsSchema = z.object({
  id: z.string().uuid('id geçerli bir UUID olmalı'),
});

const imageParamsSchema = paramsSchema.extend({
  kind: z.enum(['original', 'anonymized', 'thumbnail']),
});

interface MultipartPayload {
  metadata: unknown;
  image: { buffer: Buffer; declaredMimeType: string };
}

/**
 * `multipart/form-data` gövdesini ayrıştırır:
 *  - `report` alanı: ihbar metadatası (JSON string)
 *  - `image` alanı: JPEG/PNG/WebP dosyası
 */
async function readMultipart(request: FastifyRequest): Promise<MultipartPayload> {
  let metadata: unknown;
  let image: MultipartPayload['image'] | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'image') {
        // Beklenmeyen dosya alanı: akışı tüket ve yok say.
        await part.toBuffer();
        continue;
      }

      if (image) {
        throw badRequest('Yalnızca tek bir görsel yüklenebilir', 'TOO_MANY_FILES');
      }

      const buffer = await part.toBuffer();
      if (part.file.truncated) {
        throw badRequest('Görsel izin verilen boyutu aşıyor', 'PAYLOAD_TOO_LARGE');
      }

      image = { buffer, declaredMimeType: part.mimetype };
      continue;
    }

    if (part.fieldname !== 'report') {
      continue;
    }

    if (typeof part.value !== 'string') {
      throw badRequest('`report` alanı JSON metni olmalı');
    }

    if (Buffer.byteLength(part.value, 'utf8') > MAX_METADATA_BYTES) {
      throw badRequest('`report` alanı çok büyük', 'PAYLOAD_TOO_LARGE');
    }

    try {
      metadata = JSON.parse(part.value);
    } catch {
      throw unprocessable('`report` alanı geçerli JSON değil', [
        { path: 'report', message: 'JSON ayrıştırılamadı' },
      ]);
    }
  }

  if (metadata === undefined) {
    throw unprocessable('`report` alanı zorunlu', [
      { path: 'report', message: 'İhbar metadatası eksik' },
    ]);
  }

  if (!image) {
    throw unprocessable('`image` alanı zorunlu', [
      { path: 'image', message: 'İhbar görseli eksik' },
    ]);
  }

  return { metadata, image };
}

export const reportsRoutes: FastifyPluginAsync<ReportsRoutesOptions> = async (app, opts) => {
  /**
   * POST /v1/reports
   * Yeni ihbar oluşturur. Aynı `clientReportId` tekrar gönderilirse
   * mevcut kayıt HTTP 200 + `Idempotent-Replay: true` ile döner.
   */
  app.post('/reports', async (request, reply) => {
    if (!request.isMultipart()) {
      throw unsupportedMedia('İstek `multipart/form-data` olmalı');
    }

    const payload = await readMultipart(request);
    const outcome = await opts.service.createReport(payload);

    reply
      .code(outcome.replayed ? 200 : 201)
      .header('location', `/v1/reports/${outcome.report.id}`);

    if (outcome.replayed) {
      reply.header('idempotent-replay', 'true');
    }

    return { data: outcome.report };
  });

  /** GET /v1/reports — sayfalı liste (özet; görseller hariç). */
  app.get('/reports', async (request) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw unprocessable(
        'Sorgu parametreleri geçersiz',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(sorgu)',
          message: issue.message,
        })),
      );
    }

    const result = await opts.service.listReports(parsed.data);
    return {
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.items.length < result.total,
      },
    };
  });

  /** GET /v1/reports/:id — tek ihbar (görseller dahil). */
  app.get('/reports/:id', async (request) => {
    const params = parseParams(request.params, paramsSchema);
    const report = await opts.service.getReport(params.id);
    return { data: report };
  });

  /** GET /v1/reports/:id/images/:kind — görseli ikili olarak döndürür. */
  app.get('/reports/:id/images/:kind', async (request, reply) => {
    const params = parseParams(request.params, imageParamsSchema);
    const { record, data } = await opts.service.getImage(params.id, params.kind);

    return reply
      .header('content-type', record.mimeType || data.contentType)
      .header('content-length', String(data.body.byteLength))
      // KVKK: görseller tarayıcıda önbelleklenmemeli.
      .header('cache-control', 'private, max-age=0, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(data.body);
  });

  /** GET /v1/meta — ihlal türleri ve karar eşikleri. */
  app.get('/meta', async () => {
    const meta = await opts.service.getMeta();
    return { data: meta };
  });
};

function parseParams<T extends z.ZodTypeAny>(raw: unknown, schema: T): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw unprocessable(
      'Yol parametreleri geçersiz',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(parametre)',
        message: issue.message,
      })),
    );
  }
  return parsed.data as z.infer<T>;
}
