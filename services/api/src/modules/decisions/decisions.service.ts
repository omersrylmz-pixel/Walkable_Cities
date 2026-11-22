import { conflict, notFound } from '../../shared/errors.js';
import type { ReportsRepository } from '../reports/reports.repository.js';
import type { DecisionOutcome, DecisionThresholds } from '../reports/reports.types.js';
import type { DecisionsRepository } from './decisions.repository.js';
import {
  MANUAL_DECISIONS,
  MANUAL_DECISION_STATUS,
  REVIEWABLE_STATUSES,
  type ApplyDecisionInput,
  type ApplyDecisionResult,
  type AuditPage,
  type DecisionState,
  type ReviewQueueQuery,
  type ReviewQueueResult,
  type ThresholdSnapshot,
} from './decisions.types.js';

/** Veritabanı okunamazsa kullanılan başlangıç eşikleri (infra/init.sql seed ile aynı). */
export const DEFAULT_THRESHOLDS: DecisionThresholds = {
  autoAccept: 0.85,
  manualReview: 0.6,
};

export interface DecisionsServiceDeps {
  repository: DecisionsRepository;
  reportsRepository: ReportsRepository;
  now?: () => Date;
}

/**
 * Karar hattı: eşikleri açılışta veritabanından okur, inceleme kuyruğunu
 * önceliklendirir ve manuel kararları denetim iziyle birlikte yazar.
 *
 * Otomatik kararlar (auto_accept / manual_review / auto_reject) veritabanı
 * tetikleyicisi tarafından skor geldiğinde atanır; bu servis yalnızca manuel
 * moderasyon kararlarını ve eşik önbelleğini yönetir.
 */
export class DecisionsService {
  private thresholds: DecisionThresholds = DEFAULT_THRESHOLDS;
  private loadedAt: Date | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: DecisionsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Açılışta çağrılır; hata durumunda varsayılan eşikler korunur. */
  async initialize(): Promise<void> {
    await this.refreshThresholds();
  }

  async refreshThresholds(): Promise<DecisionThresholds> {
    const thresholds = await this.deps.reportsRepository.getThresholds();
    assertValidThresholds(thresholds);

    this.thresholds = thresholds;
    this.loadedAt = this.now();
    return thresholds;
  }

  getThresholds(): ThresholdSnapshot {
    return {
      autoAccept: this.thresholds.autoAccept,
      manualReview: this.thresholds.manualReview,
      loadedAt: this.loadedAt?.toISOString() ?? null,
    };
  }

  /** Skoru üç aşamalı karara çevirir; DB fonksiyonu `decision_for_score` ile aynı sınırlar. */
  classify(score: number): DecisionOutcome {
    if (score >= this.thresholds.autoAccept) {
      return 'auto_accept';
    }
    if (score >= this.thresholds.manualReview) {
      return 'manual_review';
    }
    return 'auto_reject';
  }

  async listReviewQueue(query: ReviewQueueQuery): Promise<ReviewQueueResult> {
    const page = await this.deps.reportsRepository.list({
      status: 'pending_review',
      violationType: query.violationType,
      minScore: query.minScore,
      maxScore: query.maxScore,
      sort: 'score',
      limit: query.limit,
      offset: query.offset,
    });

    return { ...page, thresholds: this.getThresholds() };
  }

  async applyDecision(input: {
    reportId: string;
    decision: ApplyDecisionInput['decision'];
    note: string | null;
    actorId: string | null;
    override: boolean;
  }): Promise<ApplyDecisionResult> {
    const state = await this.requireState(input.reportId);

    if (!REVIEWABLE_STATUSES.includes(state.status)) {
      throw conflict(
        `İhbar "${state.status}" durumunda; yalnızca analizi tamamlanmış kayıtlara karar verilebilir`,
        'DECISION_NOT_ALLOWED',
      );
    }

    const alreadyManual = isManualDecision(state.decision);
    if (alreadyManual && !input.override) {
      throw conflict(
        'Bu ihbar için manuel karar zaten verilmiş. Değiştirmek için override=true gönderin',
        'DECISION_ALREADY_FINAL',
      );
    }

    if (state.decision === input.decision && !input.override) {
      throw conflict(
        `İhbar zaten "${input.decision}" kararına sahip`,
        'DECISION_ALREADY_FINAL',
      );
    }

    const audit = await this.deps.repository.applyDecision({
      reportId: state.id,
      decision: input.decision,
      status: MANUAL_DECISION_STATUS[input.decision],
      note: normalizeNote(input.note),
      actorId: input.actorId,
      override: input.override,
      previousDecision: state.decision,
      previousStatus: state.status,
      thresholds: { ...this.thresholds },
    });

    const report = await this.deps.reportsRepository.findById(state.id);
    if (!report) {
      throw notFound('İhbar bulunamadı');
    }

    return { report, audit, thresholds: this.getThresholds() };
  }

  async listAudit(reportId: string, limit: number, offset: number): Promise<AuditPage> {
    await this.requireState(reportId);
    return this.deps.repository.listAudit(reportId, limit, offset);
  }

  private async requireState(reportId: string): Promise<DecisionState> {
    const state = await this.deps.repository.findState(reportId);
    if (!state) {
      throw notFound('İhbar bulunamadı');
    }
    return state;
  }
}

export function assertValidThresholds(thresholds: DecisionThresholds): void {
  const { autoAccept, manualReview } = thresholds;

  if (
    !Number.isFinite(autoAccept) ||
    !Number.isFinite(manualReview) ||
    autoAccept < 0 ||
    autoAccept > 1 ||
    manualReview < 0 ||
    manualReview > 1
  ) {
    throw new Error(
      `Karar eşikleri 0–1 aralığında olmalı (autoAccept=${autoAccept}, manualReview=${manualReview})`,
    );
  }

  if (manualReview > autoAccept) {
    throw new Error(
      `Manuel inceleme eşiği otomatik kabul eşiğinden büyük olamaz (${manualReview} > ${autoAccept})`,
    );
  }
}

function isManualDecision(value: DecisionOutcome | null): boolean {
  return value !== null && (MANUAL_DECISIONS as readonly string[]).includes(value);
}

function normalizeNote(note: string | null): string | null {
  if (note === null) {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
}
