import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { unprocessable } from '../../shared/errors.js';
import { VIOLATION_TYPES } from '../reports/reports.types.js';
import type { DecisionsService } from './decisions.service.js';
import { MANUAL_DECISIONS } from './decisions.types.js';

export interface DecisionsRoutesOptions {
  service: DecisionsService;
}

const reviewQueueQuerySchema = z
  .object({
    violationType: z.enum(VIOLATION_TYPES).optional(),
    minScore: z.coerce.number().min(0).max(1).optional(),
    maxScore: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) =>
      value.minScore === undefined ||
      value.maxScore === undefined ||
      value.minScore <= value.maxScore,
    { message: 'minScore, maxScore değerinden büyük olamaz', path: ['minScore'] },
  );

const reportParamsSchema = z.object({
  id: z.string().uuid('id geçerli bir UUID olmalı'),
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const decisionBodySchema = z
  .object({
    decision: z.enum(MANUAL_DECISIONS),
    note: z.string().trim().max(1000).optional(),
    /** Faz 4'te Supabase Auth oturumundan doldurulacak. */
    actorId: z.string().uuid('actorId geçerli bir UUID olmalı').optional(),
    override: z.boolean().default(false),
  })
  .strict();

export const decisionsRoutes: FastifyPluginAsync<DecisionsRoutesOptions> = async (app, opts) => {
  /**
   * GET /v1/review-queue
   * Manuel inceleme bekleyen ihbarları güven skoruna göre (yüksekten düşüğe)
   * döndürür. Karar eşikleri yanıtla birlikte gelir; panel eşikleri ayrıca
   * sorgulamak zorunda kalmaz.
   */
  app.get('/review-queue', async (request) => {
    const query = parse(reviewQueueQuerySchema, request.query, 'Sorgu parametreleri geçersiz');
    const result = await opts.service.listReviewQueue(query);

    return {
      data: result.items,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.items.length < result.total,
      },
      thresholds: result.thresholds,
    };
  });

  /**
   * PATCH /v1/reports/:id/decision
   * Moderatör kararı (kabul/ret) verir. Karar ve denetim kaydı tek işlemde
   * yazılır. Daha önce manuel karar verilmiş kayıtlar `override=true`
   * gönderilmedikçe değiştirilemez; skor güncellense bile manuel karar korunur.
   */
  app.patch('/reports/:id/decision', async (request) => {
    const params = parse(reportParamsSchema, request.params, 'Yol parametreleri geçersiz');
    const body = parse(decisionBodySchema, request.body, 'Karar verisi geçersiz');

    const result = await opts.service.applyDecision({
      reportId: params.id,
      decision: body.decision,
      note: body.note ?? null,
      actorId: body.actorId ?? null,
      override: body.override,
    });

    return { data: result };
  });

  /** GET /v1/reports/:id/audit — ihbarın değiştirilemez denetim izi. */
  app.get('/reports/:id/audit', async (request) => {
    const params = parse(reportParamsSchema, request.params, 'Yol parametreleri geçersiz');
    const query = parse(auditQuerySchema, request.query, 'Sorgu parametreleri geçersiz');
    const result = await opts.service.listAudit(params.id, query.limit, query.offset);

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
};

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown, message: string): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw unprocessable(
      message,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(istek)',
        message: issue.message,
      })),
    );
  }
  return parsed.data as z.infer<T>;
}
