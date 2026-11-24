import { isRole, type Role } from './roles';

/**
 * HMAC ile imzalanmış, çerez tabanlı oturum.
 *
 * Edge (middleware) ve Node (route handler / server action) çalışma
 * zamanlarının ikisinde de çalışsın diye yalnızca Web Crypto kullanılır.
 * Oturumda Supabase erişim belirteci saklanmaz; Supabase yalnızca kimlik
 * doğrulama anında kullanılır.
 */

export const SESSION_COOKIE = 'yaya_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 saat

export interface SessionPayload {
  /** Kullanıcı kimliği (UUID). Audit kayıtlarında `actorId` olarak kullanılır. */
  sub: string;
  name: string;
  email: string;
  role: Role;
  /** Veriliş zamanı (Unix saniye). */
  iat: number;
  /** Bitiş zamanı (Unix saniye). */
  exp: number;
}

const FALLBACK_SECRET = 'yaya-web-dev-session-secret-change-me';
const encoder = new TextEncoder();

function getSecret(): string {
  return process.env.WEB_SESSION_SECRET?.trim() || FALLBACK_SECRET;
}

/** Üretimde varsayılan sırla çalışılıp çalışılmadığını bildirir (uyarı banner'ı için). */
export function isUsingFallbackSecret(): boolean {
  return !process.env.WEB_SESSION_SECRET?.trim();
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return toBase64Url(bytes);
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createSessionPayload(input: {
  sub: string;
  name: string;
  email: string;
  role: Role;
  now?: Date;
}): SessionPayload {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return {
    sub: input.sub,
    name: input.name,
    email: input.email,
    role: input.role,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
  };
}

/** Oturumu `payload.signature` biçiminde imzalar. */
export async function signSession(payload: SessionPayload): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(getSecret());
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** İmzayı ve son kullanma tarihini doğrular; geçersizse `null` döner. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let expected: string;
  try {
    const key = await importKey(getSecret());
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    expected = bytesToBase64Url(new Uint8Array(digest));
  } catch {
    return null;
  }

  if (!constantTimeEqual(signature, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }

  if (!isSessionPayload(parsed)) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (parsed.exp <= nowSeconds) return null;

  return parsed;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.email === 'string' &&
    isRole(candidate.role) &&
    typeof candidate.iat === 'number' &&
    typeof candidate.exp === 'number'
  );
}
