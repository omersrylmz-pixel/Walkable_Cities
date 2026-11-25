import { describe, expect, it } from 'vitest';

import { AnalyticsService } from '../src/modules/analytics/analytics.service.js';

describe('AnalyticsService', () => {
  it('aralık penceresini bugüne göre hesaplar ve hücre üst sınırını döndürür', async () => {
    const service = new AnalyticsService({
      repository: {
        h3Density: async (query) => ({
          cells: [
            {
              cell: '609448326416302079',
              count: 12,
              avgScore: 0.7,
              pendingCount: 3,
              geometry: { type: 'Polygon', coordinates: [] },
            },
            {
              cell: '609448326483410943',
              count: 4,
              avgScore: 0.5,
              pendingCount: 1,
              geometry: { type: 'Polygon', coordinates: [] },
            },
          ],
          totalReports: 16,
          avgScore: 0.65,
          topAreas: [{ name: 'Kadıköy', count: 16 }],
        }),
      },
      now: () => new Date('2026-11-25T12:00:00.000Z'),
    });

    const result = await service.h3Density({ resolution: 7, range: '30d' });

    expect(result.maxCount).toBe(12);
    expect(result.cellCount).toBe(2);
    expect(result.totalReports).toBe(16);
    expect(result.topAreas[0]).toEqual({ name: 'Kadıköy', count: 16 });
  });

  it('"all" aralığında başlangıç sınırı göndermez', async () => {
    let captured: { from?: Date } | undefined;

    const service = new AnalyticsService({
      repository: {
        h3Density: async (query) => {
          captured = { from: query.from };
          return { cells: [], totalReports: 0, avgScore: null, topAreas: [] };
        },
      },
      now: () => new Date('2026-11-25T12:00:00.000Z'),
    });

    await service.h3Density({ resolution: 7, range: 'all' });

    expect(captured?.from).toBeUndefined();
  });
});
