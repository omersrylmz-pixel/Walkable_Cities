/** Yönetici ayarları ve sistem denetim izi sözleşmeleri. */

import type { DecisionThresholds } from '../reports/reports.types.js';

export const SYSTEM_ROLES = ['municipality_admin', 'moderator', 'viewer', 'citizen', 'service'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export interface SystemActor {
  id: string;
  displayName: string | null;
  email: string | null;
  role: SystemRole;
  isActive: boolean;
}

export interface PrivacySettings {
  /** Yeni ihbarların görselleri için saklama süresi (gün). */
  retentionDays: number;
  /** Anonimleştirme başarısızsa ihbar reddedilsin mi? */
  anonymizationRequired: boolean;
}

export interface SystemSettings {
  thresholds: DecisionThresholds;
  privacy: PrivacySettings;
  /** Eşiklerin okunduğu an (ISO-8601). */
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

export interface UpdateThresholdsInput {
  autoAccept: number;
  manualReview: number;
}

export interface UpdatePrivacyInput {
  retentionDays: number;
  anonymizationRequired: boolean;
}
