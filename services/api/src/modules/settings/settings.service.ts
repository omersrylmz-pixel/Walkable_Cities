import { forbidden, unauthorized } from '../../shared/errors.js';
import { assertValidThresholds } from '../decisions/decisions.service.js';
import type { DecisionThresholds } from '../reports/reports.types.js';
import type { SettingsRepository } from './settings.repository.js';
import type {
  PrivacySettings,
  SystemAuditEntry,
  SystemAuditPage,
  SystemSettings,
  UpdatePrivacyInput,
  UpdateThresholdsInput,
} from './settings.types.js';

export interface SettingsServiceDeps {
  repository: SettingsRepository;
  /** Eşikler değiştiğinde karar servisinin önbelleğini tazelemek için. */
  onThresholdsChanged?: (thresholds: DecisionThresholds) => Promise<void> | void;
  now?: () => Date;
}

/**
 * Yönetici ayarları servisi.
 *
 * API'de kimlik doğrulama katmanı olmadığı için panel, oturumdaki kullanıcının
 * UUID'sini `x-actor-id` başlığıyla gönderir. Bu servis her yazma işleminde
 * aktörü `app_user` tablosundan doğrular ve yalnızca `municipality_admin`
 * rolüne izin verir. Böylece panel kapısı atlatılsa bile ayarlar korunur.
 */
export class SettingsService {
  private readonly now: () => Date;

  constructor(private readonly deps: SettingsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async getSettings(actorId: string | null): Promise<SystemSettings> {
    await this.requireAdmin(actorId);

    const [thresholds, privacy] = await Promise.all([
      this.deps.repository.getThresholds(),
      this.deps.repository.getPrivacy(),
    ]);

    return {
      thresholds,
      privacy,
      loadedAt: this.now().toISOString(),
    };
  }

  async updateThresholds(
    actorId: string | null,
    input: UpdateThresholdsInput,
  ): Promise<{ settings: SystemSettings; audit: SystemAuditEntry }> {
    await this.requireAdmin(actorId);

    assertValidThresholds(input);

    const previous = await this.deps.repository.getThresholds();
    const audit = await this.deps.repository.saveThresholds({
      actorId: actorId as string,
      previous,
      next: input,
    });

    await this.deps.onThresholdsChanged?.(input);

    return { settings: await this.getSettings(actorId), audit };
  }

  async updatePrivacy(
    actorId: string | null,
    input: UpdatePrivacyInput,
  ): Promise<{ settings: SystemSettings; audit: SystemAuditEntry }> {
    await this.requireAdmin(actorId);
    assertValidPrivacy(input);

    const previous = await this.deps.repository.getPrivacy();
    const audit = await this.deps.repository.savePrivacy({
      actorId: actorId as string,
      previous,
      next: input,
    });

    return { settings: await this.getSettings(actorId), audit };
  }

  async listAudit(
    actorId: string | null,
    limit: number,
    offset: number,
  ): Promise<SystemAuditPage> {
    await this.requireAdmin(actorId);
    return this.deps.repository.listAudit(limit, offset);
  }

  private async requireAdmin(actorId: string | null) {
    if (!actorId) {
      throw unauthorized('Bu işlem için yönetici oturumu gerekli', 'ACTOR_REQUIRED');
    }

    const actor = await this.deps.repository.findActor(actorId);
    if (!actor) {
      throw unauthorized('Aktör bulunamadı', 'ACTOR_NOT_FOUND');
    }
    if (!actor.isActive) {
      throw forbidden('Kullanıcı hesabı pasif durumda', 'ACTOR_INACTIVE');
    }
    if (actor.role !== 'municipality_admin') {
      throw forbidden(
        'Bu işlem yalnızca belediye yöneticisi rolüne açıktır',
        'ADMIN_REQUIRED',
      );
    }

    return actor;
  }
}

export function assertValidPrivacy(input: PrivacySettings): void {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 30 || input.retentionDays > 3650) {
    throw new Error('Saklama süresi 30–3650 gün arasında bir tam sayı olmalı');
  }
}
