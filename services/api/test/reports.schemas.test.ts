import { describe, expect, it } from 'vitest';

import { parseReportMetadata } from '../src/modules/reports/reports.schemas.js';

const NOW = new Date('2026-03-15T12:00:00.000Z');

/** Doğrulama hatasının alan bazlı ayrıntısını doğrular. */
function expectValidationError(
  fn: () => unknown,
  path: string,
  message: RegExp,
): void {
  try {
    fn();
    throw new Error('Doğrulama hatası bekleniyordu');
  } catch (error) {
    const appError = error as {
      statusCode?: number;
      details?: { path: string; message: string }[];
    };
    expect(appError.statusCode).toBe(422);
    const detail = appError.details?.find((item) => item.path === path);
    expect(detail?.message).toMatch(message);
  }
}

function validMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientReportId: '3f5d1f9e-6f9f-4b3f-9d3b-6d1f9a2c4b7e',
    violationType: 'kaldirim_isgali',
    capturedAt: '2026-03-15T11:58:00.000Z',
    location: {
      latitude: 41.0082,
      longitude: 28.9784,
      accuracyM: 8.5,
    },
    description: 'Kaldırımda park etmiş araç',
    severity: 4,
    ...overrides,
  };
}

describe('parseReportMetadata', () => {
  it('geçerli metadatayı varsayılanlarla normalize eder', () => {
    const parsed = parseReportMetadata(validMetadata(), NOW);

    expect(parsed.violationType).toBe('kaldirim_isgali');
    expect(parsed.location.source).toBe('device');
    expect(parsed.device.platform).toBe('unknown');
    expect(parsed.description).toBe('Kaldırımda park etmiş araç');
  });

  it('capturedAt UTC ofsetini dakika olarak korur', () => {
    expect(
      parseReportMetadata(validMetadata({ capturedAt: '2026-03-15T11:58:00+03:00' }), NOW)
        .capturedAtOffsetMinutes,
    ).toBe(180);
    expect(parseReportMetadata(validMetadata(), NOW).capturedAtOffsetMinutes).toBe(0);
  });

  it('5 dakikadan fazla gelecekteki capturedAt değerini reddeder', () => {
    const future = new Date(NOW.getTime() + 6 * 60 * 1000).toISOString();

    expectValidationError(
      () => parseReportMetadata(validMetadata({ capturedAt: future }), NOW),
      'capturedAt',
      /gelecekte olamaz/,
    );
  });

  it('5 dakikaya kadar saat kaymasını tolere eder', () => {
    const slightlyFuture = new Date(NOW.getTime() + 2 * 60 * 1000).toISOString();

    expect(() => parseReportMetadata(validMetadata({ capturedAt: slightlyFuture }), NOW)).not.toThrow();
  });

  it('180 günden eski capturedAt değerini reddeder', () => {
    expectValidationError(
      () => parseReportMetadata(validMetadata({ capturedAt: '2025-01-01T00:00:00.000Z' }), NOW),
      'capturedAt',
      /180 günden eski/,
    );
  });

  it('150 metreden kötü GPS doğruluğunu reddeder', () => {
    const metadata = validMetadata({
      location: { latitude: 41, longitude: 29, accuracyM: 250 },
    });

    expectValidationError(
      () => parseReportMetadata(metadata, NOW),
      'location.accuracyM',
      /GPS doğruluğu/,
    );
  });

  it('geçersiz UUID ve ihlal türünü reddeder', () => {
    expect(() => parseReportMetadata(validMetadata({ clientReportId: 'abc' }), NOW)).toThrow();
    expect(() => parseReportMetadata(validMetadata({ violationType: 'bilinmeyen' }), NOW)).toThrow();
  });

  it('kapsam dışı koordinatları reddeder', () => {
    const metadata = validMetadata({
      location: { latitude: 91, longitude: 29, accuracyM: 5 },
    });

    expect(() => parseReportMetadata(metadata, NOW)).toThrow();
  });

  it('doğrulama hatalarını alan yollarıyla birlikte döner', () => {
    try {
      parseReportMetadata(validMetadata({ clientReportId: 'abc' }), NOW);
      throw new Error('hata bekleniyordu');
    } catch (error) {
      const appError = error as { statusCode: number; details?: { path: string }[] };
      expect(appError.statusCode).toBe(422);
      expect(appError.details?.some((detail) => detail.path === 'clientReportId')).toBe(true);
    }
  });
});
