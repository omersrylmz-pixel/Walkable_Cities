/** Panel rolleri ve yetki matrisi. */

export const ROLES = ['municipality_admin', 'moderator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  municipality_admin: 'Belediye yöneticisi',
  moderator: 'Moderatör',
  viewer: 'İzleyici',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  municipality_admin: 'Tüm ihbarlar, orijinal görseller, karar ve yönetim.',
  moderator: 'İnceleme kuyruğu, karar verme ve orijinal görsel erişimi.',
  viewer: 'Salt okunur özetler; yalnızca anonimleştirilmiş görseller.',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Manuel karar verebilen roller. */
export function canReview(role: Role): boolean {
  return role === 'moderator' || role === 'municipality_admin';
}

/** KVKK: orijinal (anonimleştirilmemiş) görsele erişebilen roller. */
export function canViewOriginal(role: Role): boolean {
  return role === 'moderator' || role === 'municipality_admin';
}

/** Karar eşiklerini görüntüleme herkese açık; değiştirme yalnızca yönetici. */
export function canManageSettings(role: Role): boolean {
  return role === 'municipality_admin';
}
