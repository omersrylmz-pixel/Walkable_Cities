import Link from 'next/link';

import { StatusBadge } from '@/components/reports/status-badge';
import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { listReports } from '@/lib/api-client';
import { canReview } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';
import {
  STATUS_LABELS,
  VIOLATION_LABELS,
  formatDateTime,
  formatScore,
} from '@/lib/format';
import {
  REPORT_STATUSES,
  VIOLATION_TYPES,
  type ListSort,
  type ReportStatus,
  type ViolationType,
} from '@/lib/types';

export const metadata = { title: 'İhbarlar' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pickStatus(value: string | undefined): ReportStatus | undefined {
  return value && (REPORT_STATUSES as readonly string[]).includes(value)
    ? (value as ReportStatus)
    : undefined;
}

function pickViolation(value: string | undefined): ViolationType | undefined {
  return value && (VIOLATION_TYPES as readonly string[]).includes(value)
    ? (value as ViolationType)
    : undefined;
}

function pickSort(value: string | undefined): ListSort {
  return value === 'score' ? 'score' : 'recent';
}

function pickScore(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return undefined;
  return parsed;
}

function pickOffset(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser('/reports');
  const params = await searchParams;

  const status = pickStatus(first(params.status));
  const violationType = pickViolation(first(params.violationType));
  const sort = pickSort(first(params.sort));
  const minScore = pickScore(first(params.minScore));
  const maxScore = pickScore(first(params.maxScore));
  const offset = pickOffset(first(params.offset));
  const limit = 20;

  let result: Awaited<ReturnType<typeof listReports>>;
  try {
    result = await listReports({ status, violationType, sort, minScore, maxScore, limit, offset });
  } catch (error) {
    return (
      <>
        <PageHeader title="İhbarlar" description="Tüm ihbar kayıtları ve filtreleme." />
        <ApiErrorPanel error={error} />
      </>
    );
  }

  const queryParams: Record<string, string | undefined> = {
    status,
    violationType,
    sort: sort === 'recent' ? undefined : sort,
    minScore: minScore?.toString(),
    maxScore: maxScore?.toString(),
  };

  const hasFilters = Boolean(status || violationType || minScore !== undefined || maxScore !== undefined);
  const reviewer = canReview(user.role);

  return (
    <>
      <PageHeader
        title="İhbarlar"
        description="Tür, durum ve güven skoruna göre filtreleyin. Görseller KVKK gereği yalnızca inceleme ekranında gösterilir."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
          <CardDescription>Seçimler adres çubuğuna yansır; bağlantı paylaşılabilir.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="status">Durum</Label>
              <Select id="status" name="status" defaultValue={status ?? ''}>
                <option value="">Tümü</option>
                {REPORT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
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

            <div className="space-y-2">
              <Label htmlFor="sort">Sıralama</Label>
              <Select id="sort" name="sort" defaultValue={sort}>
                <option value="recent">En yeni</option>
                <option value="score">Güven skoru</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minScore">Min. skor</Label>
              <Input
                id="minScore"
                name="minScore"
                type="number"
                min={0}
                max={1}
                step={0.05}
                inputMode="decimal"
                defaultValue={minScore}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxScore">Maks. skor</Label>
              <Input
                id="maxScore"
                name="maxScore"
                type="number"
                min={0}
                max={1}
                step={0.05}
                inputMode="decimal"
                defaultValue={maxScore}
                placeholder="1.00"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 xl:col-span-5">
              <button type="submit" className={buttonVariants({ size: 'sm' })}>
                Filtrele
              </button>
              {hasFilters ? (
                <Link href="/reports" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Filtreleri temizle
                </Link>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState
          title="Kayıt bulunamadı"
          description="Seçili filtrelerle eşleşen ihbar yok. Filtreleri temizleyip yeniden deneyin."
          action={
            hasFilters ? (
              <Link href="/reports" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Filtreleri temizle
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="data-table">
              <caption className="sr-only">İhbar listesi</caption>
              <thead>
                <tr>
                  <th scope="col">İhlal türü</th>
                  <th scope="col" className="hidden md:table-cell">Konum (H3)</th>
                  <th scope="col">Durum</th>
                  <th scope="col">Skor</th>
                  <th scope="col" className="hidden sm:table-cell">Görsel</th>
                  <th scope="col">Yakalandı</th>
                  <th scope="col" className="text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <span className="font-medium">{VIOLATION_LABELS[report.violationType]}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {report.description ? `${report.description.slice(0, 80)}${report.description.length > 80 ? '…' : ''}` : '—'}
                      </span>
                    </td>
                    <td className="hidden md:table-cell">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{report.h3.cell ?? 'yok'}</code>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {report.location.latitude.toFixed(5)}, {report.location.longitude.toFixed(5)}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={report.status} />
                    </td>
                    <td className="tabular-nums">{formatScore(report.confidenceScore)}</td>
                    <td className="hidden sm:table-cell">
                      <Badge variant="outline">{report.imageCount}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(report.capturedAt)}
                    </td>
                    {reviewer ? (
                      <td className="text-right">
                        <Link
                          href={`/review/${report.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          İncele
                        </Link>
                      </td>
                    ) : (
                      <td className="text-right">
                        <Link
                          href={`/reports/${report.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          Detay
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <Pagination
              total={result.pagination.total}
              limit={result.pagination.limit}
              offset={result.pagination.offset}
              basePath="/reports"
              params={queryParams}
            />
          </div>
        </>
      )}
    </>
  );
}
