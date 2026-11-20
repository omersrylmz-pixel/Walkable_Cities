import { describe, expect, it } from 'vitest';

import { NEAR_DUPLICATE_THRESHOLD, nearDuplicateScore } from '../src/modules/reports/reports.service.js';

describe('nearDuplicateScore', () => {
  it('aynı konum ve zaman için 1 döner', () => {
    expect(nearDuplicateScore(0, 0)).toBe(1);
  });

  it('mesafe arttıkça skor düşer', () => {
    const close = nearDuplicateScore(10, 600);
    const far = nearDuplicateScore(60, 600);

    expect(close).toBeGreaterThan(far);
  });

  it('zaman farkı arttıkça skor düşer', () => {
    const fresh = nearDuplicateScore(10, 60);
    const stale = nearDuplicateScore(10, 5 * 3600);

    expect(fresh).toBeGreaterThan(stale);
  });

  it('yarıçap sınırında mesafe katkısı sıfırlanır', () => {
    // 75 m sınırında yalnızca zaman bileşeni kalır: 0.4
    expect(nearDuplicateScore(75, 0)).toBeCloseTo(0.4, 3);
  });

  it('pencere dışı zaman farkını kırpar', () => {
    expect(nearDuplicateScore(0, 100 * 3600)).toBe(0.6);
  });

  it('eşik değeri 0.70 olarak sabittir', () => {
    expect(NEAR_DUPLICATE_THRESHOLD).toBe(0.7);
  });

  it('eşik altı/üstü ayrımı beklenen şekilde çalışır', () => {
    // 20 m + 1 saat: 0.6*(1-20/75) + 0.4*(1-1/6) = 0.44 + 0.3333 = 0.773
    expect(nearDuplicateScore(20, 3600)).toBeGreaterThan(NEAR_DUPLICATE_THRESHOLD);

    // 70 m + 5 saat: 0.6*(1-70/75) + 0.4*(1-5/6) = 0.04 + 0.0667 = 0.107
    expect(nearDuplicateScore(70, 5 * 3600)).toBeLessThan(NEAR_DUPLICATE_THRESHOLD);
  });
});
