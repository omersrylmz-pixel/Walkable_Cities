import { describe, expect, it, vi } from 'vitest';

import { SettingsService } from '../src/modules/settings/settings.service.js';
import type { SettingsRepository } from '../src/modules/settings/settings.repository.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const MODERATOR_ID = '22222222-2222-4222-8222-222222222222';

function makeRepository(role: 'municipality_admin' | 'moderator' = 'municipality_admin') {
  const state = {
    thresholds: { autoAccept: 0.85, manualReview: 0.6 },
    privacy: { retentionDays: 730, anonymizationRequired: true },
  };

  return {
    state,
    findActor: vi.fn(async (id: string) => ({
      id,
      displayName: 'Test Kullanıcı',
      email: 'test@belediye.example',
      role: id === MODERATOR_ID ? 'moderator' : role,
      isActive: true,
    })),
    getThresholds: vi.fn(async () => ({ ...state.thresholds })),
    getPrivacy: vi.fn(async () => ({ ...state.privacy })),
    saveThresholds: vi.fn(async (input: { actorId: string; next: { autoAccept: number; manualReview: number } }) => {
      state.thresholds = { ...input.next };
      return {
        id: '1',
        actorId: input.actorId,
        action: 'settings.thresholds.updated',
        targetKey: 'decision.thresholds',
        before: {},
        after: input.next,
        createdAt: new Date().toISOString(),
      };
    }),
    savePrivacy: vi.fn(async (input: { actorId: string; next: { retentionDays: number; anonymizationRequired: boolean } }) => {
      state.privacy = { ...input.next };
      return {
        id: '2',
        actorId: input.actorId,
        action: 'settings.privacy.updated',
        targetKey: 'privacy.policy',
        before: {},
        after: input.next,
        createdAt: new Date().toISOString(),
      };
    }),
    listAudit: vi.fn(async () => ({ items: [], total: 0, limit: 50, offset: 0 })),
  } satisfies Partial<SettingsRepository>;
}

describe('SettingsService rol denetimi', () => {
  it('aktör olmadan ayarları okumayı reddeder', async () => {
    const service = new SettingsService({ repository: makeRepository() as SettingsRepository });

    await expect(service.getSettings(null)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('moderatör rolü ayar değiştiremez', async () => {
    const service = new SettingsService({ repository: makeRepository() as SettingsRepository });

    await expect(service.updateThresholds(MODERATOR_ID, { autoAccept: 0.9, manualReview: 0.7 })).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADMIN_REQUIRED',
    });
  });

  it('yönetici eşiği günceller, audit yazar ve önbelleği tazeler', async () => {
    const onThresholdsChanged = vi.fn(async () => undefined);
    const repository = makeRepository();
    const service = new SettingsService({
      repository: repository as SettingsRepository,
      onThresholdsChanged,
    });

    const result = await service.updateThresholds(ADMIN_ID, {
      autoAccept: 0.9,
      manualReview: 0.7,
    });

    expect(result.settings.thresholds).toEqual({ autoAccept: 0.9, manualReview: 0.7 });
    expect(repository.saveThresholds).toHaveBeenCalledTimes(1);
    expect(onThresholdsChanged).toHaveBeenCalledWith({ autoAccept: 0.9, manualReview: 0.7 });
    expect(result.audit.action).toBe('settings.thresholds.updated');
  });

  it('eşik sırası tersse (manual > auto) güncelleme reddedilir', async () => {
    const service = new SettingsService({ repository: makeRepository() as SettingsRepository });

    await expect(
      service.updateThresholds(ADMIN_ID, { autoAccept: 0.5, manualReview: 0.9 }),
    ).rejects.toThrow(/eşiğinden büyük/);
  });

  it('KVKK politikası güncellenir', async () => {
    const repository = makeRepository();
    const service = new SettingsService({ repository: repository as SettingsRepository });

    const result = await service.updatePrivacy(ADMIN_ID, {
      retentionDays: 365,
      anonymizationRequired: false,
    });

    expect(result.settings.privacy).toEqual({ retentionDays: 365, anonymizationRequired: false });
    expect(repository.savePrivacy).toHaveBeenCalledTimes(1);
  });
});
