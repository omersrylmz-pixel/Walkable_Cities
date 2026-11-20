import { z } from 'zod';

import { unprocessable } from '../../shared/errors.js';
import { GPS_SOURCES, VIOLATION_TYPES } from './reports.types.js';

/** Sunucu tarafı GPS doğruluk üst sınırı (metre). */
export const MAX_GPS_ACCURACY_M = 150;

/** Gelecekte kabul edilen en fazla zaman kayması (5 dk). */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Geçmişe dönük en fazla ihbar yaşı (180 gün) — DB trigger'ı ile aynı. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

const metadataBaseSchema = z.object({
  clientReportId: z.string().uuid('clientReportId geçerli bir UUID olmalı'),
  violationType: z.enum(VIOLATION_TYPES),
  capturedAt: z.string().datetime({ offset: true, message: 'capturedAt ISO-8601 olmalı' }),
  location: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyM: z.number().finite().min(0).max(5000).optional(),
    source: z.enum(GPS_SOURCES).default('device'),
  }),
  device: z
    .object({
      platform: z.enum(['android', 'ios', 'web', 'unknown']).default('unknown'),
      osVersion: z.string().trim().max(50).optional(),
      appVersion: z.string().trim().max(30).optional(),
      clockDriftSeconds: z.number().finite().min(-86_400).max(86_400).optional(),
    })
    .default({}),
  description: z.string().trim().max(500).optional(),
  severity: z.number().int().min(1).max(5).optional(),
});

export type ReportMetadata = z.infer<typeof metadataBaseSchema>;

/**
 * İstemciden gelen ihbar metadatasını doğrular ve normalize eder.
 * `now` enjekte edilebilir; testlerde deterministik davranış sağlar.
 */
export function parseReportMetadata(raw: unknown, now: Date = new Date()): ReportMetadata {
  const result = metadataBaseSchema
    .superRefine((value, ctx) => {
      const capturedAt = Date.parse(value.capturedAt);

      if (Number.isNaN(capturedAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capturedAt'],
          message: 'capturedAt ayrıştırılamadı',
        });
        return;
      }

      if (capturedAt > now.getTime() + MAX_FUTURE_SKEW_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capturedAt'],
          message: 'capturedAt gelecekte olamaz (cihaz saati hatalı olabilir)',
        });
      }

      if (capturedAt < now.getTime() - MAX_AGE_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capturedAt'],
          message: 'capturedAt 180 günden eski olamaz',
        });
      }

      const accuracy = value.location.accuracyM;
      if (accuracy !== undefined && accuracy > MAX_GPS_ACCURACY_M) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['location', 'accuracyM'],
          message: `GPS doğruluğu ${MAX_GPS_ACCURACY_M} m'den kötü olamaz`,
        });
      }
    })
    .safeParse(raw);

  if (!result.success) {
    throw unprocessable(
      'İhbar verisi doğrulanamadı',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(kök)',
        message: issue.message,
      })),
    );
  }

  return result.data;
}
