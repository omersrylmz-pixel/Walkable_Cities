import { NextResponse, type NextRequest } from 'next/server';

import {
  DEV_USERS,
  getSupabaseConfig,
  isDevAuthEnabled,
  type DevUserKey,
} from '@/lib/auth/dev-users';
import { isRole, type Role } from '@/lib/auth/roles';
import { setSessionCookie } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

function errorRedirect(request: NextRequest, next: string, message: string) {
  const url = new URL('/login', request.url);
  url.searchParams.set('next', next);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const next = safeNext(form.get('next'));

  if (isDevAuthEnabled()) {
    const key = form.get('devUser');
    if (typeof key === 'string' && key in DEV_USERS) {
      const user = DEV_USERS[key as DevUserKey];
      await setSessionCookie(user);
      return NextResponse.redirect(new URL(next, request.url), 303);
    }
    return errorRedirect(request, next, 'Geçerli bir demo kullanıcı seçin.');
  }

  const supabase = getSupabaseConfig();
  if (!supabase) {
    return errorRedirect(
      request,
      next,
      'Kimlik doğrulama yapılandırılmamış. SUPABASE_URL ve SUPABASE_ANON_KEY tanımlayın veya geliştirme oturumunu açın.',
    );
  }

  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!email || !password) {
    return errorRedirect(request, next, 'E-posta ve parola zorunludur.');
  }

  let response: Response;
  try {
    response = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: supabase.anonKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return errorRedirect(request, next, 'Kimlik doğrulama servisine ulaşılamadı.');
  }

  if (!response.ok) {
    return errorRedirect(request, next, 'E-posta veya parola hatalı.');
  }

  const payload = (await response.json()) as {
    user?: {
      id?: string;
      email?: string;
      app_metadata?: { role?: unknown };
      user_metadata?: { role?: unknown; full_name?: unknown };
    };
  };

  const user = payload.user;
  if (!user?.id) {
    return errorRedirect(request, next, 'Oturum bilgisi alınamadı.');
  }

  const role: Role = isRole(user.app_metadata?.role)
    ? user.app_metadata.role
    : isRole(user.user_metadata?.role)
      ? user.user_metadata.role
      : 'viewer';

  const fullName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? email);

  await setSessionCookie({
    sub: user.id,
    name: fullName,
    email: user.email ?? email,
    role,
  });

  return NextResponse.redirect(new URL(next, request.url), 303);
}
