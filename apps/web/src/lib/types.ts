/** API sözleşmeleri (services/api/src/modules/reports ve decisions ile hizalı). */

export const VIOLATION_TYPES = [
  'kaldirim_isgali',
  'yaya_gecidi_ihlali',
  'sabit_engel',
  'yuzey_bozulmasi',
  'gecici_engel',
] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const REPORT_STATUSES = [
  'draft',
  'queued',
  'processing',
  'auto_approved',
  'pending_review',
  'auto_rejected',
  'approved',
  'rejected',
  'failed',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const DECISION_OUTCOMES = [
  'auto_accept',
  'manual_review',
  'auto_reject',
  'manual_accept',
  'manual_reject',
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const MANUAL_DECISIONS = ['manual_accept', 'manual_reject'] as const;
export type ManualDecision = (typeof MANUAL_DECISIONS)[number];

export type MediaKind = 'original' | 'anonymized' | 'thumbnail';
export type GpsSource = 'device' | 'exif' | 'manual';
export type ListSort = 'recent' | 'score';

export interface ReportImageDto {
  id: string;
  kind: MediaKind;
  storagePath: string;
  mimeType: string;
  byteSize: number | null;
  width: number | null;
  height: number | null;
  sha256: string;
  blurApplied: boolean;
  createdAt: string;
}

export interface ReportDto {
  id: string;
  clientReportId: string;
  violationType: ViolationType;
  violationLabel: string | null;
  status: ReportStatus;
  decision: DecisionOutcome | null;
  confidenceScore: number | null;
  severity: number | null;
  description: string | null;
  capturedAt: string;
  receivedAt: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    source: GpsSource;
  };
  h3: {
    cell: string | null;
    resolution: number;
  };
  modelVersion: string | null;
  /** AI analizi özeti: kaynak, tespit sayısı, gerekçeler. */
  aiMetadata: Record<string, unknown> | null;
  duplicateOf: string | null;
  duplicateScore: number | null;
  anonymizedAt: string | null;
  retentionExpiresAt: string;
  integrity: Record<string, unknown> | null;
  images: ReportImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportSummaryDto extends Omit<ReportDto, 'images'> {
  imageCount: number;
}

export interface ViolationTypeMeta {
  code: ViolationType;
  labelTr: string;
  description: string | null;
  defaultSeverity: number;
}

export interface DecisionThresholds {
  autoAccept: number;
  manualReview: number;
}

export interface ThresholdSnapshot extends DecisionThresholds {
  loadedAt: string | null;
}

export interface ListReportsQuery {
  status?: ReportStatus;
  violationType?: ViolationType;
  sort?: ListSort;
  minScore?: number;
  maxScore?: number;
  /** ISO-8601 alt sınır (dahil). */
  from?: string;
  /** ISO-8601 üst sınır (hariç). */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ReviewQueueQuery {
  violationType?: ViolationType;
  minScore?: number;
  maxScore?: number;
  limit?: number;
  offset?: number;
}

export interface ReviewQueueResponse {
  items: ReportSummaryDto[];
  total: number;
  limit: number;
  offset: number;
  thresholds: ThresholdSnapshot;
}

export interface AuditEntry {
  id: string;
  action: string;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApplyDecisionResult {
  report: ReportDto;
  audit: AuditEntry;
  thresholds: ThresholdSnapshot;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** ---------------- Ayarlar ve sistem denetimi (services/api settings) ------- */

export interface PrivacySettings {
  retentionDays: number;
  anonymizationRequired: boolean;
}

export interface SystemSettings {
  thresholds: DecisionThresholds;
  privacy: PrivacySettings;
  loadedAt: string | null;
}

export interface SystemAuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  targetKey: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface SystemAuditPage {
  items: SystemAuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface SettingsMutationResult {
  settings: SystemSettings;
  audit: SystemAuditEntry;
}

/** ---------------- Mekânsal analitik (services/api analytics) --------------- */

export type AnalyticsRange = '7d' | '30d' | '90d' | '180d' | 'all';
export type AnalyticsResolution = 7 | 8 | 9;
/** Harita filtresinde sunulan anlaşılır durum grupları. */
export type AnalyticsStatusGroup = 'approved' | 'pending' | 'rejected';

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

export interface H3Analytics {
  resolution: AnalyticsResolution;
  totalReports: number;
  cellCount: number;
  maxCount: number;
  avgScore: number | null;
  cells: H3CellFeature[];
  topAreas: H3AreaSummary[];
}
