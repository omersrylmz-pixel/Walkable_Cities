import { NextResponse } from 'next/server';

import { fetchReportImage } from '@/lib/api-client';
import { canViewOriginal } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/auth/server';
import type { MediaKind } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: readonly MediaKind[] = ['original', 'anonymized', 'thumbnail'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; kind: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse('Oturum gerekli', { status: 401 });
  }

  const { id, kind } = await params;
  if (!UUID_PATTERN.test(id)) {
    return new NextResponse('Geçersiz ihbar kimliği', { status: 400 });
  }

  if (!KINDS.includes(kind as MediaKind)) {
    return new NextResponse('Geçersiz görsel türü', { status: 400 });
  }

  // KVKK: orijinal görsel yalnızca yetkili rollere açılır.
  if (kind === 'original' && !canViewOriginal(user.role)) {
    return new NextResponse('Bu görsele erişim yetkiniz yok', { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetchReportImage(id, kind as MediaKind);
  } catch {
    return new NextResponse('Görsel servisine ulaşılamadı', { status: 503 });
  }

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    return new NextResponse(status === 404 ? 'Görsel bulunamadı' : 'Görsel alınamadı', { status });
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  headers.set('cache-control', 'private, max-age=0, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-disposition', 'inline');
  const length = upstream.headers.get('content-length');
  if (length) headers.set('content-length', length);

  return new NextResponse(upstream.body, { status: 200, headers });
}
