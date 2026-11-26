import { Layers, MapPin } from 'lucide-react';
import Link from 'next/link';

import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ReportMap, type MapPoint, type ServerH3 } from '@/components/map/report-map';
import { getAllReportSummaries, getH3Analytics } from '@/lib/api-client';
import { canReview } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';
import { VIOLATION_LABELS, formatNumber, formatScore } from '@/lib/format';
import {
  VIOLATION_TYPES,
  type AnalyticsRange,
  type AnalyticsResolution,
  type ViolationType,
} from '@/lib/types';

export const metadata = { title: 'Harita' };
export const dynamic = 'force-dynamic';

const MAX_POINTS = 2_000;

const RANGES: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '7d', label: 'Son 7 gün' },
  { value: '30d', label: 'Son 30 gün' },
  { value: '90d', label: 'Son 90 gün' },
  { value: '180d', label: 'Son 180 gün' },
  { value: 'all', label: 'Tüm zamanlar' },
];

const RESOLUTIONS: Array<{ value: AnalyticsResolution; label: string }> = [
  { value: 7, label: 'Res 7 · şehir ölçeği (~5 km²)' },
  { value: 8, label: 'Res 8 · ilçe ölçeği (~1 km²)' },
  { value: 9, label: 'Res 9 · mahalle ölçeği (~0.1 km²)' },
];

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pickRange(value: string | undefined): AnalyticsRange {
  return RANGES.some((range) => range.value === value) ? (value as AnalyticsRange) : '30d';
}

function pickResolution(value: string | undefined): AnalyticsResolution {
  const parsed = Number(value);
  return parsed === 7 || parsed === 8 || parsed === 9 ? parsed : 8;
}

function pickViolation(value: string | undefined): ViolationType | undefined {
  return value && (VIOLATION_TYPES as readonly string[]).includes(value)
    ? (value as ViolationType)
    : undefined;
}

/** Nokta katmanı da aynı zaman penceresiyle süzülür. */
function rangeStart(range: AnalyticsRange, now: Date): Date | null {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : range === '180d' ? 180 : null;
  if (days === null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser('/map');
  const params = await searchParams;

  const resolution = pickResolution(first(params.resolution));
  const range = pickRange(first(params.range));
  const violationType = pickViolation(first(params.violationType));

  let points: MapPoint[] = [];
  let filteredTotal = 0;
  let analytics: Awaited<ReturnType<typeof getH3Analytics>> | null = null;

  try {
    // Zaman aralığı ve ihlal türü sunucu tarafında uygulanır; böylece 2.000
    // kayıt sınırı dolmadan önce alakasız kayıtlar elenmez.
    const start = rangeStart(range, new Date());
    const [reports, h3] = await Promise.all([
      getAllReportSummaries(MAX_POINTS, {
        violationType,
        from: start?.toISOString(),
      }),
      getH3Analytics({ resolution, range, violationType }),
    ]);

    analytics = h3;
    filteredTotal = h3.totalReports;

    points = reports
      .filter(
        (report) =>
          Number.isFinite(report.location.latitude) &&
          Number.isFinite(report.location.longitude),
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

  const serverH3: ServerH3 | null = analytics
    ? {
        featureCollection: {
          type: 'FeatureCollection',
          features: analytics.cells.map((cell) => ({
            type: 'Feature' as const,
            properties: {
              cell: cell.cell,
              count: cell.count,
              avgScore: cell.avgScore,
              pendingCount: cell.pendingCount,
            },
            geometry: cell.geometry,
          })),
        },
        maxCount: analytics.maxCount,
        resolution: analytics.resolution,
        totalReports: analytics.totalReports,
        topAreas: analytics.topAreas,
      }
    : null;

  const hasFilter = Boolean(violationType) || range !== '30d' || resolution !== 8;

  return (
    <>
      <PageHeader
        title="Harita"
        description="Nokta kümeleme ve sunucu tarafında H3 yoğunluk görünümü. Filtreler API'de uygulanır."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="info">{formatNumber(points.length)} nokta</Badge>
            {filteredTotal > MAX_POINTS ? (
              <Badge variant="outline">son {formatNumber(MAX_POINTS)} kayıt</Badge>
            ) : null}
          </div>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Analiz filtreleri</CardTitle>
          <CardDescription>
            H3 yoğunluğu ve noktalar bu filtrelerle süzülür; seçim adres çubuğuna yansır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="resolution">Çözünürlük</Label>
              <Select id="resolution" name="resolution" defaultValue={String(resolution)}>
                {RESOLUTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="range">Zaman aralığı</Label>
              <Select id="range" name="range" defaultValue={range}>
                {RANGES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="violationType">İhlal türü</Label>
              <Select id="violationType" name="violationType" defaultValue={violationType ?? ''}>
                <option value="">Tümü</option>
                {VIOLATION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {VIOLATION_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-end gap-2">
              <button type="submit" className={buttonVariants({ size: 'sm' })}>
                Uygula
              </button>
              {hasFilter ? (
                <Link href="/map" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Sıfırla
                </Link>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <ReportMap points={points} canReview={canReview(user.role)} h3={serverH3} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <Layers aria-hidden="true" className="mt-1 h-5 w-5 text-primary" />
            <div className="space-y-1">
              <CardTitle className="text-base">H3 yoğunluğu</CardTitle>
              <CardDescription>
                Res {analytics?.resolution ?? resolution} · {formatNumber(analytics?.cellCount ?? 0)} hücre
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Filtreyle eşleşen <strong className="text-foreground">{formatNumber(analytics?.totalReports ?? 0)}</strong>{' '}
            ihbarın {formatNumber(analytics?.cellCount ?? 0)} farklı hücreye dağılımı. Ortalama güven
            skoru: {formatScore(analytics?.avgScore ?? null)}.
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 xl:col-span-2">
          <CardHeader className="flex-row items-start gap-3">
            <MapPin aria-hidden="true" className="mt-1 h-5 w-5 text-primary" />
            <div className="space-y-1">
              <CardTitle className="text-base">En yoğun alanlar</CardTitle>
              <CardDescription>İlçe bazında ilk 5 · sunucu tarafında adres metninden</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {!analytics || analytics.topAreas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bu filtreyle eşleşen kayıt yok.</p>
            ) : (
              <ol className="space-y-2">
                {analytics.topAreas.map((area, index) => {
                  const max = analytics.topAreas[0].count || 1;
                  return (
                    <li key={area.name} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          <span className="mr-2 text-muted-foreground">{index + 1}.</span>
                          {area.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatNumber(area.count)} ihbar
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(6, (area.count / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
