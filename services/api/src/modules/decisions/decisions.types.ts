import type {
  DecisionOutcome,
  DecisionThresholds,
  PaginatedReports,
  ReportDto,
  ReportStatus,
  ViolationType,
} from '../reports/reports.types.js';

/** Moderatörün verebileceği kararlar. */
export const MANUAL_DECISIONS = ['manual_accept', 'manual_reject'] as const;
export type ManualDecision = (typeof MANUAL_DECISIONS)[number];

export const MANUAL_DECISION_STATUS: Record<ManualDecision, ReportStatus> = {
  manual_accept: 'approved',
  manual_reject: 'rejected',
};

/** Manuel karar verilebilecek durumlar (analiz tamamlanmış kayıtlar). */
export const REVIEWABLE_STATUSES: readonly ReportStatus[] = [
  'pending_review',
  'auto_approved',
  'auto_rejected',
  'approved',
  'rejected',
];

export interface ReviewQueueQuery {
  violationType?: ViolationType;
  minScore?: number;
  maxScore?: number;
  limit: number;
  offset: number;
}

export interface ThresholdSnapshot extends DecisionThresholds {
  /** `null` ise karar eşikleri henüz veritabanından okunamadı (varsayılanlar kullanılıyor). */
  loadedAt: string | null;
}

export interface ReviewQueueResult extends PaginatedReports {
  thresholds: ThresholdSnapshot;
}

export interface DecisionState {
  id: string;
  status: ReportStatus;
  decision: DecisionOutcome | null;
  confidenceScore: number | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export interface ApplyDecisionInput {
  reportId: string;
  decision: ManualDecision;
  status: ReportStatus;
  note: string | null;
  actorId: string | null;
  override: boolean;
  previousDecision: DecisionOutcome | null;
  previousStatus: ReportStatus;
  thresholds: DecisionThresholds;
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
