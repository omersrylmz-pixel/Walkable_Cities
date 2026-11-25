import type { Pool, PoolClient } from 'pg';

import type { DecisionThresholds } from '../reports/reports.types.js';
import type {
  PrivacySettings,
  SystemActor,
  SystemAuditEntry,
  SystemAuditPage,
  SystemRole,
} from './settings.types.js';

export const THRESHOLDS_KEY = 'decision.thresholds';
export const PRIVACY_KEY = 'privacy.policy';

export interface SettingsRepository {
  findActor(actorId: string): Promise<SystemActor | null>;
  getThresholds(): Promise<DecisionThresholds>;
  getPrivacy(): Promise<PrivacySettings>;
  saveThresholds(input: {
    actorId: string;
    previous: DecisionThresholds;
    next: DecisionThresholds;
  }): Promise<SystemAuditEntry>;
  savePrivacy(input: {
    actorId: string;
    previous: PrivacySettings;
    next: PrivacySettings;
  }): Promise<SystemAuditEntry>;
  listAudit(limit: number, offset: number): Promise<SystemAuditPage>;
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  retentionDays: 730,
  anonymizationRequired: true,
};

interface ActorRow {
  id: string;
  display_name: string | null;
  email: string | null;
  role: SystemRole;
  is_active: boolean;
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_key: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  created_at: Date;
}

export class PgSettingsRepository implements SettingsRepository {
  constructor(private readonly pool: Pool) {}

  async findActor(actorId: string): Promise<SystemActor | null> {
    const { rows } = await this.pool.query<ActorRow>(
      `SELECT id, display_name, email, role, is_active
         FROM app_user
        WHERE id = $1
        LIMIT 1`,
      [actorId],
    );

    const row = rows[0];
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          email: row.email,
          role: row.role,
          isActive: row.is_active,
        }
      : null;
  }

  async getThresholds(): Promise<DecisionThresholds> {
    const value = await this.getSetting<{ auto_accept?: number; manual_review?: number }>(
      THRESHOLDS_KEY,
    );

    return {
      autoAccept: Number(value?.auto_accept ?? 0.85),
      manualReview: Number(value?.manual_review ?? 0.6),
    };
  }

  async getPrivacy(): Promise<PrivacySettings> {
    const value = await this.getSetting<{
      retention_days?: number;
      anonymization_required?: boolean;
    }>(PRIVACY_KEY);

    return {
      retentionDays: Number(value?.retention_days ?? DEFAULT_PRIVACY.retentionDays),
      anonymizationRequired:
        value?.anonymization_required ?? DEFAULT_PRIVACY.anonymizationRequired,
    };
  }

  async saveThresholds(input: {
    actorId: string;
    previous: DecisionThresholds;
    next: DecisionThresholds;
  }): Promise<SystemAuditEntry> {
    return this.saveSetting({
      actorId: input.actorId,
      key: THRESHOLDS_KEY,
      action: 'settings.thresholds.updated',
      before: { auto_accept: input.previous.autoAccept, manual_review: input.previous.manualReview },
      after: { auto_accept: input.next.autoAccept, manual_review: input.next.manualReview },
    });
  }

  async savePrivacy(input: {
    actorId: string;
    previous: PrivacySettings;
    next: PrivacySettings;
  }): Promise<SystemAuditEntry> {
    return this.saveSetting({
      actorId: input.actorId,
      key: PRIVACY_KEY,
      action: 'settings.privacy.updated',
      before: {
        retention_days: input.previous.retentionDays,
        anonymization_required: input.previous.anonymizationRequired,
      },
      after: {
        retention_days: input.next.retentionDays,
        anonymization_required: input.next.anonymizationRequired,
      },
    });
  }

  async listAudit(limit: number, offset: number): Promise<SystemAuditPage> {
    const [{ rows }, countResult] = await Promise.all([
      this.pool.query<AuditRow>(
        `SELECT id::text AS id, actor_id, action, target_key, before, after, created_at
           FROM system_audit_log
          ORDER BY created_at DESC, id DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM system_audit_log`),
    ]);

    return {
      items: rows.map(mapAudit),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  private async getSetting<T>(key: string): Promise<T | null> {
    const { rows } = await this.pool.query<{ value: T }>(
      `SELECT value FROM system_setting WHERE key = $1 LIMIT 1`,
      [key],
    );
    return rows[0]?.value ?? null;
  }

  /**
   * Ayar güncellemesi ve denetim kaydı tek işlemde yazılır. Denetim kaydı
   * yazılamazsa ayar da geri alınır.
   */
  private async saveSetting(input: {
    actorId: string;
    key: string;
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): Promise<SystemAuditEntry> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO system_setting (key, value, description)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now()`,
        [input.key, input.after, descriptionFor(input.key)],
      );

      const audit = await insertAudit(client, input);
      await client.query('COMMIT');
      return audit;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

function descriptionFor(key: string): string {
  return key === THRESHOLDS_KEY
    ? 'Güven skoru karar eşikleri: >= auto_accept otomatik kabul, >= manual_review manuel inceleme, altı otomatik ret.'
    : 'KVKK politikası: saklama süresi (gün), anonimleştirme zorunluluğu ve orijinal görsel saklama.';
}

async function insertAudit(
  client: PoolClient,
  input: {
    actorId: string;
    key: string;
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  },
): Promise<SystemAuditEntry> {
  const { rows } = await client.query<AuditRow>(
    `INSERT INTO system_audit_log (actor_id, action, target_key, before, after)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id::text AS id, actor_id, action, target_key, before, after, created_at`,
    [input.actorId, input.action, input.key, input.before, input.after],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Sistem denetim kaydı oluşturulamadı');
  }
  return mapAudit(row);
}

function mapAudit(row: AuditRow): SystemAuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    targetKey: row.target_key,
    before: row.before ?? {},
    after: row.after ?? {},
    createdAt: row.created_at.toISOString(),
  };
}
