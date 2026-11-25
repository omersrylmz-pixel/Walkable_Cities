import { describe, expect, it } from 'vitest';

import { heuristicScore } from '../src/shared/heuristic-score.js';
import type { ReportIntegrity } from '../src/shared/integrity.js';

function integrity(gps: ReportIntegrity['checks']['gps']['status'] = 'missing'): ReportIntegrity {
  return {
    exif: {
      present: gps !== 'missing',
      capturedAt: null,
      gps: null,
      make: null,
      model: null,
      software: null,
    },
    checks: {
      gps: { status: gps, difference: null, tolerance: 100 },
      capturedAt: { status: 'missing', difference: null, tolerance: 300 },
    },
    anonymization: { status: 'applied', backend: 'test', facesBlurred: 1, platesBlurred: 0, error: null },
    checkedAt: new Date().toISOString(),
  };
}

describe('kural tabanlı yedek skor', () => {
  it('aynı girdi için deterministiktir', () => {
    const input = {
      violationType: 'kaldirim_isgali' as const,
      severity: 3,
      description: 'Kaldırım tamamen araç tarafından işgal edilmiş durumda.',
      integrity: integrity('match'),
      duplicateOf: null,
    };

    expect(heuristicScore(input).score).toBe(heuristicScore(input).score);
  });

  it('mükerrer ihbarı otomatik redd bandına çeker', () => {
    const score = heuristicScore({
      violationType: 'yaya_gecidi_ihlali',
      severity: 5,
      description: 'Araç yaya geçidini tamamen kapatmış, süreli ihlal.',
      integrity: integrity('match'),
      duplicateOf: '11111111-1111-4111-8111-111111111111',
    }).score;

    expect(score).toBeLessThanOrEqual(0.25);
  });

  it('EXIF GPS uyuşmazlığını cezalandırır', () => {
    const base = {
      violationType: 'sabit_engel' as const,
      severity: 3,
      description: null as string | null,
      duplicateOf: null as string | null,
    };

    const match = heuristicScore({ ...base, integrity: integrity('match') }).score;
    const mismatch = heuristicScore({ ...base, integrity: integrity('mismatch') }).score;

    expect(mismatch).toBeLessThan(match);
  });

  it('skor 0–1 aralığında kalır', () => {
    for (const description of [null, 'kısa', 'çok uzun bir açıklama metni buraya yazılır']) {
      const score = heuristicScore({
        violationType: 'gecici_engel',
        severity: 1,
        description,
        integrity: integrity('mismatch'),
        duplicateOf: null,
      }).score;

      expect(score).toBeGreaterThanOrEqual(0.05);
      expect(score).toBeLessThanOrEqual(0.97);
    }
  });
});
