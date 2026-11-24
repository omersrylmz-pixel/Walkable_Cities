import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { ReportMap, type MapPoint } from '@/components/map/report-map';
import { getAllReportSummaries, listReports } from '@/lib/api-client';
import { canReview } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';

export const metadata = { title: 'Harita' };
export const dynamic = 'force-dynamic';

const MAX_POINTS = 2_000;

export default async function MapPage() {
  const user = await requireUser('/map');

  let points: MapPoint[] = [];
  let total = 0;

  try {
    const [summary, reports] = await Promise.all([
      listReports({ limit: 1 }),
      getAllReportSummaries(MAX_POINTS),
    ]);
    total = summary.pagination.total;
    points = reports
      .filter(
        (report) =>
          Number.isFinite(report.location.latitude) && Number.isFinite(report.location.longitude),
      )
      .map((report) => ({
        id: report.id,
        lat: report.location.latitude,
        lng: report.location.longitude,
        violationType: report.violationType,
        status: report.status,
        score: report.confidenceScore,
        capturedAt: report.capturedAt,
        cell: report.h3.cell,
      }));
  } catch (error) {
    return (
      <>
        <PageHeader title="Harita" description="İhbarların mekânsal dağılımı." />
        <ApiErrorPanel error={error} title="Harita verileri alınamadı" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Harita"
        description="Nokta kümeleme ve H3 tabanlı yoğunluk görünümü. Katman düğmeleriyle görünümü değiştirin."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="info">{points.length} nokta</Badge>
            {total > points.length ? (
              <Badge variant="outline">son {MAX_POINTS} kayıt</Badge>
            ) : null}
          </div>
        }
      />

      <ReportMap points={points} canReview={canReview(user.role)} />

      <div className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Sunucu tarafı H3 agregasyonu ve Gi* sıcak nokta katmanı Faz 5'te eklenecek. Şu an choropleth
        istemcide, yüklenen kayıtlar üzerinden hesaplanır. Toplam kayıt: {total}.
      </div>
    </>
  );
}
