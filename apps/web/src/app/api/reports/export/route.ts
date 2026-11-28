import { NextResponse } from 'next/server';

import { getAllReportSummaries } from '@/lib/api-client';
import { getSessionUser } from '@/lib/auth/server';
import { REPORT_EXPORT_MAX_ROWS, buildReportsCsv } from '@/lib/report-export';
import { parseReportFilters } from '@/lib/report-filters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Paneliçi filtreli CSV dışa aktarma.
 *
 * Filtreler ihbar listesiyle aynı kurallarla ayrıştırılır; böylece ekranda
 * görünen seçimler indirilen dosyaya birebir yansır. KVKK gereği görsel
 * içerik dışa aktarılmaz, yalnızca özet alanlar yer alır.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse('Oturum gerekli', { status: 401 });
  }

  const url = new URL(request.url);
  const filters = parseReportFilters((key) => url.searchParams.get(key) ?? undefined);

  let items: Awaited<ReturnType<typeof getAllReportSummaries>>;
  try {
    items = await getAllReportSummaries(REPORT_EXPORT_MAX_ROWS, filters);
  } catch {
    return new NextResponse('İhbar listesi alınamadı', { status: 503 });
  }

  const csv = buildReportsCsv(items);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ihbarlar-${stamp}.csv"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-exported-rows': String(items.length),
    },
  });
}
