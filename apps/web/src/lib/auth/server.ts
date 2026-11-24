import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { canReview, type Role } from './roles';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionPayload,
  signSession,
  verifySession,
  type SessionPayload,
} from './session';

/** Sunucu tarafında geçerli oturum; yoksa `null`. */
export async function getSessionUser(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Oturum yoksa giriş sayfasına yönlendirir. */
export async function requireUser(nextPath = '/dashboard'): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}

/** Rol yetkisi yoksa panele `denied` bilgisiyle yönlendirir. */
export async function requireRole(
  roles: readonly Role[],
  nextPath = '/dashboard',
): Promise<SessionPayload> {
  const user = await requireUser(nextPath);
  if (!roles.includes(user.role)) {
    redirect('/dashboard?denied=1');
  }
  return user;
}

/** Karar verme yetkisi gerektiren sayfalar için kısayol. */
export async function requireReviewer(nextPath = '/review'): Promise<SessionPayload> {
  const user = await requireUser(nextPath);
  if (!canReview(user.role)) {
    redirect('/dashboard?denied=1');
  }
  return user;
}

export async function setSessionCookie(input: {
  sub: string;
  name: string;
  email: string;
  role: Role;
}): Promise<void> {
  const store = await cookies();
  const payload = createSessionPayload(input);
  const token = await signSession(payload);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
