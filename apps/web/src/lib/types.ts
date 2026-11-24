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
