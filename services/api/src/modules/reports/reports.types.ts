import type { ReportIntegrity } from '../../shared/integrity.js';

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

export const GPS_SOURCES = ['device', 'exif', 'manual'] as const;
export type GpsSource = (typeof GPS_SOURCES)[number];

export const MEDIA_KINDS = ['original', 'anonymized', 'thumbnail'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

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
  integrity: ReportIntegrity | null;
  images: ReportImageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportSummaryDto extends Omit<ReportDto, 'images'> {
  imageCount: number;
}

export interface NewReportInput {
  clientReportId: string;
  violationType: ViolationType;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  gpsSource: GpsSource;
  description: string | null;
  severity: number | null;
  deviceInfo: Record<string, unknown>;
  duplicateOf: string | null;
  duplicateScore: number | null;
  anonymizedAt: Date | null;
  retentionExpiresAt: Date;
  integrity: ReportIntegrity;
  images: NewReportImageInput[];
}

export interface NewReportImageInput {
  kind: MediaKind;
  storagePath: string;
  sha256: Buffer;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  blurApplied: boolean;
  facesBlurred: number;
  platesBlurred: number;
  exifRemoved: boolean;
}

export interface ImageDuplicateMatch {
  reportId: string;
}

export interface NearDuplicateMatch {
  reportId: string;
  distanceM: number;
  ageSeconds: number;
}

export const LIST_SORTS = ['recent', 'score'] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export interface ListReportsQuery {
  status?: ReportStatus;
  violationType?: ViolationType;
  /** `score`: güven skoru azalan (inceleme kuyruğu); `recent`: yakalanma zamanı azalan. */
  sort?: ListSort;
  minScore?: number;
  maxScore?: number;
  limit: number;
  offset: number;
}

export interface PaginatedReports {
  items: ReportSummaryDto[];
  total: number;
  limit: number;
  offset: number;
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

export interface ReportImageRecord {
  storagePath: string;
  mimeType: string;
}

/**
 * İhbar oluşturma sonucu.
 * `replayed`, aynı `clientReportId` ile daha önce kayıt oluşturulduğunu
 * (idempotent tekrar) belirtir; bu durumda HTTP 200 döner.
 */
export interface CreateReportOutcome {
  report: ReportDto;
  replayed: boolean;
}
