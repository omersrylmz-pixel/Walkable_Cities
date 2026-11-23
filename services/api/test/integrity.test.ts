import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EXIF_GPS_TOLERANCE_M,
  EXIF_TIME_TOLERANCE_SECONDS,
  evaluateExifIntegrity,
  haversineMeters,
  parseCapturedAtOffsetMinutes,
  parseExifTimestamp,
  readExifSnapshot,
} from '../src/shared/integrity.js';

const EXIF_FIXTURE = readFileSync(new URL('./fixtures/exif-sample.jpg', import.meta.url));
const PLAIN_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };

describe('EXIF yardımcıları', () => {
  it('EXIF zaman damgasını saat dilimsiz ISO biçimine çevirir', () => {
    expect(parseExifTimestamp('2026:03:15 11:58:00')).toBe('2026-03-15T11:58:00');
    expect(parseExifTimestamp('2026-03-15T11:58:03')).toBe('2026-03-15T11:58:03');
    expect(parseExifTimestamp('geçersiz')).toBeNull();
    expect(parseExifTimestamp(undefined)).toBeNull();
  });

  it('ISO ofsetini dakikaya çevirir', () => {
    expect(parseCapturedAtOffsetMinutes('2026-03-15T11:58:00Z')).toBe(0);
    expect(parseCapturedAtOffsetMinutes('2026-03-15T11:58:00+03:00')).toBe(180);
    expect(parseCapturedAtOffsetMinutes('2026-03-15T11:58:00-05:30')).toBe(-330);
    expect(parseCapturedAtOffsetMinutes('2026-03-15T11:58:00')).toBe(0);
  });

  it('haversine mesafesini metre cinsinden hesaplar', () => {
    const distance = haversineMeters(41.0082, 28.9784, 39.9334, 32.8597);
    expect(distance).toBeGreaterThan(340_000);
    expect(distance).toBeLessThan(360_000);
    expect(haversineMeters(41.0082, 28.9784, 41.0082, 28.9784)).toBe(0);
  });
});

describe('readExifSnapshot', () => {
  it('GPS, üretici ve zaman bilgisini okur', async () => {
    const snapshot = await readExifSnapshot(EXIF_FIXTURE);

    expect(snapshot).toMatchObject({
      present: true,
      capturedAt: '2026-03-15T11:58:00',
      make: 'TestMake',
      model: 'TestModel',
      software: 'WalkableCitiesTest',
    });
    expect(snapshot.gps?.latitude).toBeCloseTo(ISTANBUL.latitude, 4);
    expect(snapshot.gps?.longitude).toBeCloseTo(ISTANBUL.longitude, 3);
  });

  it('EXIF taşımayan görselde tüm alanları boş döndürür', async () => {
    const snapshot = await readExifSnapshot(PLAIN_PNG);

    expect(snapshot).toEqual({
      present: false,
      capturedAt: null,
      gps: null,
      make: null,
      model: null,
      software: null,
    });
  });
});

describe('evaluateExifIntegrity', () => {
  const baseInput = {
    // 11:58 +03:00 = 08:58Z; duvar saati karşılaştırması 11:58 vermeli.
    capturedAt: new Date('2026-03-15T08:58:00.000Z'),
    capturedAtOffsetMinutes: 180,
    latitude: ISTANBUL.latitude,
    longitude: ISTANBUL.longitude,
  };

  it('konum ve zaman tolerans içindeyse match işaretler', async () => {
    const result = await evaluateExifIntegrity(EXIF_FIXTURE, baseInput);

    expect(result.checks.gps.status).toBe('match');
    expect(result.checks.gps.difference).toBeLessThan(10);
    expect(result.checks.capturedAt.status).toBe('match');
    expect(result.checks.capturedAt.difference).toBe(0);
  });

  it('uzak konumu mismatch olarak işaretler', async () => {
    const result = await evaluateExifIntegrity(EXIF_FIXTURE, {
      ...baseInput,
      latitude: 39.9334,
      longitude: 32.8597,
    });

    expect(result.checks.gps.status).toBe('mismatch');
    expect(result.checks.gps.tolerance).toBe(EXIF_GPS_TOLERANCE_M);
    expect(result.checks.gps.difference).toBeGreaterThan(EXIF_GPS_TOLERANCE_M);
  });

  it('tolerans dışı zamanı mismatch olarak işaretler', async () => {
    const result = await evaluateExifIntegrity(EXIF_FIXTURE, {
      ...baseInput,
      capturedAt: new Date('2026-03-15T14:30:00.000Z'),
    });

    expect(result.checks.capturedAt.status).toBe('mismatch');
    expect(result.checks.capturedAt.tolerance).toBe(EXIF_TIME_TOLERANCE_SECONDS);
    expect(result.checks.capturedAt.difference).toBeGreaterThan(EXIF_TIME_TOLERANCE_SECONDS);
  });

  it('EXIF yoksa kontrolleri missing döndürür', async () => {
    const result = await evaluateExifIntegrity(PLAIN_PNG, baseInput);

    expect(result.exif.present).toBe(false);
    expect(result.checks.gps.status).toBe('missing');
    expect(result.checks.capturedAt.status).toBe('missing');
  });
});
