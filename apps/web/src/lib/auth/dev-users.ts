import type { Role } from './roles';

/**
 * Geliştirme ortamı için sabit demo kullanıcıları.
 * UUID'ler audit kayıtlarındaki `actorId` alanının geçerli olması için sabittir.
 */
export interface DevUser {
  sub: string;
  name: string;
  email: string;
  role: Role;
}

export const DEV_USERS: Record<'admin' | 'moderator' | 'viewer', DevUser> = {
  admin: {
    sub: '11111111-1111-4111-8111-111111111111',
    name: 'Ayşe Yılmaz',
    email: 'ayse.yilmaz@belediye.example',
    role: 'municipality_admin',
  },
  moderator: {
    sub: '22222222-2222-4222-8222-222222222222',
    name: 'Mert Demir',
    email: 'mert.demir@belediye.example',
    role: 'moderator',
  },
  viewer: {
    sub: '33333333-3333-4333-8333-333333333333',
    name: 'Selin Kaya',
    email: 'selin.kaya@belediye.example',
    role: 'viewer',
  },
};

export type DevUserKey = keyof typeof DEV_USERS;

export function isDevAuthEnabled(): boolean {
  if (process.env.WEB_DEV_AUTH === 'false') return false;
  if (process.env.WEB_DEV_AUTH === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Supabase kimlik bilgileri tanımlıysa döner. */
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/u, ''), anonKey };
}
