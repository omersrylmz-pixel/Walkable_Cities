/** Sunucu tarafı H3 yoğunluk analitiği sözleşmeleri. */

import type { ReportStatus, ViolationType } from '../reports/reports.types.js';

export const ANALYTICS_RANGES = ['7d', '30d', '90d', '180d', 'all'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const ANALYTICS_RESOLUTIONS = [7, 8, 9] as const;
export type AnalyticsResolution = (typeof ANALYTICS_RESOLUTIONS)[number];

export interface H3AnalyticsQuery {
  resolution: AnalyticsResolution;
  violationType?: ViolationType;
  statuses?: ReportStatus[];
  from?: Date;
  to?: Date;
}

export interface H3CellFeature {
  cell: string;
  count: number;
  avgScore: number | null;
  pendingCount: number;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface H3AreaSummary {
  name: string;
  count: number;
}

export interface H3AnalyticsResult {
  resolution: AnalyticsResolution;
  totalReports: number;
  cellCount: number;
  maxCount: number;
  avgScore: number | null;
  cells: H3CellFeature[];
  topAreas: H3AreaSummary[];
}

export interface H3AnalyticsRepository {
  h3Density(query: H3AnalyticsQuery): Promise<{
    cells: H3CellFeature[];
    totalReports: number;
    avgScore: number | null;
    topAreas: H3AreaSummary[];
  }>;
}
