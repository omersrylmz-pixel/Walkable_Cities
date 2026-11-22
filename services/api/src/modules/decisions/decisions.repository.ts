import type { Pool, PoolClient } from 'pg';

import type { DecisionOutcome, ReportStatus } from '../reports/reports.types.js';
import type { ApplyDecisionInput, AuditEntry, AuditPage, DecisionState } from './decisions.types.js';

export interface DecisionsRepository {
  findState(reportId: string): Promise<DecisionState | null>;
  /**
   * Manuel kararı ve denetim kaydını tek işlemde (transaction) yazar.
   * Denetim kaydı, karar değişikliğiyle birlikte atomik olarak oluşur.
   */
  applyDecision(input: ApplyDecisionInput): Promise<AuditEntry>;
  listAudit(reportId: string, limit: number, offset: number): Promise<AuditPage>;
}

interface StateRow {
  id: string;
  status: ReportStatus;
  decision: DecisionOutcome | null;
  confidence_score: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  from_status: ReportStatus | null;
  to_status: ReportStatus | null;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export class PgDecisionsRepository implements DecisionsRepository {
  constructor(private readonly pool: Pool) {}

  async findState(reportId: string): Promise<DecisionState | null> {
    const { rows } = await this.pool.query<StateRow>(
      `SELECT id, status, decision, confidence_score, reviewed_at, reviewed_by
         FROM reports
        WHERE id = $1
        LIMIT 1`,
      [reportId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
      decision: row.decision,
      confidenceScore: row.confidence_score === null ? null : Number(row.confidence_score),
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      reviewedBy: row.reviewed_by,
    };
  }

  async applyDecision(input: ApplyDecisionInput): Promise<AuditEntry> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1) Denetim izi: kim, ne zaman, hangi kararı, hangi eşiklerle verdi.
      const audit = await this.insertAudit(client, input);

      // 2) Karar + durum güncellemesi. `reviewed_at` yalnızca aktör varsa yazılır;
      //    `reports_review_consistency` kısıtı ikisinin birlikte olmasını ister.
      await client.query(
        `UPDATE reports
            SET decision = $2::decision_outcome,
                status = $3::report_status,
                review_note = $4,
                reviewed_by = $5,
                reviewed_at = CASE WHEN $5::uuid IS NULL THEN NULL ELSE now() END
          WHERE id = $1`,
        [input.reportId, input.decision, input.status, input.note, input.actorId],
      );

      await client.query('COMMIT');
      return audit;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listAudit(reportId: string, limit: number, offset: number): Promise<AuditPage> {
    const [{ rows }, countResult] = await Promise.all([
      this.pool.query<AuditRow>(
        `SELECT id::text AS id, action, from_status, to_status, actor_id, payload, created_at
           FROM report_audit_log
          WHERE report_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2 OFFSET $3`,
        [reportId, limit, offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM report_audit_log WHERE report_id = $1`,
        [reportId],
      ),
    ]);

    return {
      items: rows.map(mapAudit),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  private async insertAudit(
    client: PoolClient,
    input: ApplyDecisionInput,
  ): Promise<AuditEntry> {
    const { rows } = await client.query<AuditRow>(
      `INSERT INTO report_audit_log (
          report_id, actor_id, action, from_status, to_status, payload
       ) VALUES (
          $1, $2, 'report.decision.manual', $3::report_status, $4::report_status, $5::jsonb
       )
       RETURNING id::text AS id, action, from_status, to_status, actor_id, payload, created_at`,
      [
        input.reportId,
        input.actorId,
        input.previousStatus,
        input.status,
        {
          decision: input.decision,
          previousDecision: input.previousDecision,
          note: input.note,
          override: input.override,
          thresholds: input.thresholds,
        },
      ],
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Denetim kaydı oluşturulamadı');
    }

    return mapAudit(row);
  }
}

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    payload: row.payload ?? {},
    createdAt: row.created_at.toISOString(),
  };
}
