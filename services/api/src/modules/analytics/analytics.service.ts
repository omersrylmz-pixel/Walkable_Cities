import type {
  AnalyticsRange,
  AnalyticsResolution,
  H3AnalyticsRepository,
  H3AnalyticsResult,
} from './analytics.types.js';
import type { ViolationType } from '../reports/reports.types.js';

export interface AnalyticsServiceDeps {
  repository: H3AnalyticsRepository;
  now?: () => Date;
}

const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
};

export class AnalyticsService {
  private readonly now: () => Date;

  constructor(private readonly deps: AnalyticsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async h3Density(input: {
    resolution: AnalyticsResolution;
    range: AnalyticsRange;
    violationType?: ViolationType;
  }): Promise<H3AnalyticsResult> {
    const now = this.now();
    const from =
      input.range === 'all'
        ? undefined
        : new Date(now.getTime() - RANGE_DAYS[input.range] * 24 * 60 * 60 * 1000);

    const result = await this.deps.repository.h3Density({
      resolution: input.resolution,
      violationType: input.violationType,
      from,
      to: now,
    });

    const maxCount = result.cells.reduce((max, cell) => Math.max(max, cell.count), 0);

    return {
      resolution: input.resolution,
      totalReports: result.totalReports,
      cellCount: result.cells.length,
      maxCount,
      avgScore: result.avgScore,
      cells: result.cells,
      topAreas: result.topAreas,
    };
  }
}
