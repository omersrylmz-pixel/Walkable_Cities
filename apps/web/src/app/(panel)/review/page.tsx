import Link from 'next/link';

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
import { getReviewQueue } from '@/lib/api-client';
import { requireReviewer } from '@/lib/auth/server';
import { VIOLATION_LABELS, formatAge, formatDateTime, formatScore, formatPercent } from '@/lib/format';
import { VIOLATION_TYPES, type ViolationType } from '@/lib/types';

export const metadata = { title: 'İnceleme kuyruğu' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pickViolation(value: string | undefined): ViolationType | undefined {
  return value && (VIOLATION_TYPES as readonly string[]).includes(value)
    ? (value as ViolationType)
    : undefined;
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

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireReviewer('/review');
  const params = await searchParams;

  const violationType = pickViolation(first(params.violationType));
  const minScore = pickScore(first(params.minScore));
  const maxScore = pickScore(first(params.maxScore));
  const offset = pickOffset(first(params.offset));
  const limit = 20;

  let queue: Awaited<ReturnType<typeof getReviewQueue>>;
  try {
    queue = await getReviewQueue({ violationType, minScore, maxScore, limit, offset });
  } catch (error) {
    return (
      <>
        <PageHeader title="İnceleme kuyruğu" description="Manuel karar bekleyen ihbarlar." />
        <ApiErrorPanel error={error} />
      </>
    );
  }

  const hasFilters = Boolean(violationType || minScore !== undefined || maxScore !== undefined);
  const band = `${queue.thresholds.manualReview.toFixed(2)} – ${queue.thresholds.autoAccept.toFixed(2)}`;

  return (
    <>
      <PageHeader
        title="İnceleme kuyruğu"
        description={`Otomatik karar bandına girmeyen (${band}) ihbarlar, güven skoruna göre yüksekten düşüğe sıralanır.`}
        actions={<Badge variant="warning">{queue.total} kayıt</Badge>}
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
          <CardDescription>
            Eşikler API'den gelir; yüklenemezse varsayılan değerler kullanılır.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                placeholder={queue.thresholds.manualReview.toFixed(2)}
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
                placeholder={queue.thresholds.autoAccept.toFixed(2)}
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className={buttonVariants({ size: 'sm' })}>
                Filtrele
              </button>
              {hasFilters ? (
                <Link href="/review" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Temizle
                </Link>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {queue.items.length === 0 ? (
        <EmptyState
          title="Kuyruk temiz"
          description="Şu anda manuel inceleme bekleyen ihbar bulunmuyor. Yeni ihbarlar geldiğinde burada listelenecek."
        />
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {queue.items.map((report) => {
              const score = report.confidenceScore ?? 0;
              const scorePercent = Math.round(score * 100);
              return (
                <li key={report.id}>
                  <Card className="flex h-full flex-col">
                    <CardHeader className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <Badge variant="outline">{VIOLATION_LABELS[report.violationType]}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatAge(report.capturedAt)} önce
                        </span>
                      </div>
                      <CardTitle className="mt-2 text-lg">
                        Skor {formatScore(report.confidenceScore)}
                      </CardTitle>
                      <CardDescription>
                        {report.description ?? 'Açıklama girilmemiş.'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Güven skoru</span>
                          <span className="tabular-nums">{formatPercent(score, 0)}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${Math.min(100, Math.max(4, scorePercent))}%` }}
                          />
                        </div>
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <dt className="text-muted-foreground">Yakalandı</dt>
                          <dd>{formatDateTime(report.capturedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Görsel</dt>
                          <dd>{report.imageCount} adet</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">H3 hücresi</dt>
                          <dd>
                            <code className="rounded bg-muted px-1.5 py-0.5">{report.h3.cell ?? 'yok'}</code>
                          </dd>
                        </div>
                      </dl>
                      <Link
                        href={`/review/${report.id}`}
                        className={buttonVariants({ className: 'w-full' })}
                      >
                        İncele ve karar ver
                      </Link>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <Pagination
              total={queue.total}
              limit={queue.limit}
              offset={queue.offset}
              basePath="/review"
              params={{
                violationType,
                minScore: minScore?.toString(),
                maxScore: maxScore?.toString(),
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
