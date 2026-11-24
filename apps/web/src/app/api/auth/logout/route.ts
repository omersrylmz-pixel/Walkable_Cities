import { NextResponse, type NextRequest } from 'next/server';

import { clearSessionCookie } from '@/lib/auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
