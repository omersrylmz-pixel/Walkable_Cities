import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { unprocessable } from '../../shared/errors.js';
import type { SettingsService } from './settings.service.js';

export interface SettingsRoutesOptions {
  service: SettingsService;
}

const actorHeadersSchema = z.object({
  'x-actor-id': z.string().uuid('x-actor-id geçerli bir UUID olmalı').optional(),
});

const thresholdsSchema = z
  .object({
    autoAccept: z.number().min(0).max(1),
    manualReview: z.number().min(0).max(1),
  })
  .strict()
  .refine((value) => value.manualReview <= value.autoAccept, {
    message: 'Manuel inceleme eşiği otomatik kabul eşiğinden büyük olamaz',
    path: ['manualReview'],
  });

const privacySchema = z
  .object({
    retentionDays: z.number().int().min(30).max(3650),
    anonymizationRequired: z.boolean(),
  })
  .strict();

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (app, opts) => {
  /** GET /v1/settings — eşikler ve KVKK politikası (yalnızca yönetici). */
  app.get('/settings', async (request) => {
    const actorId = actorFrom(request.headers);
    const settings = await opts.service.getSettings(actorId);
    return { data: settings };
  });

  /** PATCH /v1/settings/thresholds — karar eşiklerini günceller + audit yazar. */
  app.patch('/settings/thresholds', async (request) => {
    const actorId = actorFrom(request.headers);
    const body = parse(thresholdsSchema, request.body, 'Eşik değerleri geçersiz');
    const result = await opts.service.updateThresholds(actorId, body);

    return { data: result };
  });

  /** PATCH /v1/settings/privacy — KVKK / saklama politikasını günceller + audit yazar. */
  app.patch('/settings/privacy', async (request) => {
    const actorId = actorFrom(request.headers);
    const body = parse(privacySchema, request.body, 'KVKK ayarları geçersiz');
    const result = await opts.service.updatePrivacy(actorId, body);

    return { data: result };
  });

  /** GET /v1/settings/audit — sistem düzeyi denetim izi. */
  app.get('/settings/audit', async (request) => {
    const actorId = actorFrom(request.headers);
    const query = parse(auditQuerySchema, request.query, 'Sorgu parametreleri geçersiz');
    const page = await opts.service.listAudit(actorId, query.limit, query.offset);

    return {
      data: page.items,
      pagination: {
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.offset + page.items.length < page.total,
      },
    };
  });
};

function actorFrom(headers: unknown): string | null {
  const parsed = actorHeadersSchema.safeParse(headers);
  if (!parsed.success) {
    throw unprocessable(
      'Aktör başlığı geçersiz',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'x-actor-id',
        message: issue.message,
      })),
    );
  }
  return parsed.data['x-actor-id'] ?? null;
}

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
