import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { unprocessable } from '../../shared/errors.js';
import { VIOLATION_TYPES } from '../reports/reports.types.js';
import type { AnalyticsService } from './analytics.service.js';
import { ANALYTICS_RANGES, ANALYTICS_RESOLUTIONS } from './analytics.types.js';

export interface AnalyticsRoutesOptions {
  service: AnalyticsService;
}

const h3QuerySchema = z.object({
  resolution: z.coerce
    .number()
    .int()
    .refine(
      (value) => (ANALYTICS_RESOLUTIONS as readonly number[]).includes(value),
      'resolution 7, 8 veya 9 olmalı',
    )
    .default(7),
  range: z.enum(ANALYTICS_RANGES).default('90d'),
  violationType: z.enum(VIOLATION_TYPES).optional(),
});

export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (app, opts) => {
  /**
   * GET /v1/analytics/h3
   * Sunucu tarafında H3 hücre yoğunluğu, ortalama skor ve ilçe özeti döndürür.
   */
  app.get('/analytics/h3', async (request) => {
    const parsed = h3QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw unprocessable(
        'Analitik sorgu parametreleri geçersiz',
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(sorgu)',
          message: issue.message,
        })),
      );
    }

    const data = await opts.service.h3Density({
      resolution: parsed.data.resolution as 7 | 8 | 9,
      range: parsed.data.range,
      violationType: parsed.data.violationType,
    });

    return { data };
  });
};
