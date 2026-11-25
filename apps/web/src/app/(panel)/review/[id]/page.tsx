import { ArrowLeft, ExternalLink, ImageOff, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { StatusBadge } from '@/components/reports/status-badge';
import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ApiError, getAudit, getMeta, getReport } from '@/lib/api-client';
import { DEV_USERS } from '@/lib/auth/dev-users';
import { canViewOriginal } from '@/lib/auth/roles';
import { requireReviewer } from '@/lib/auth/server';
import {
  DECISION_LABELS,
  STATUS_LABELS,
  VIOLATION_LABELS,
  formatAge,
  formatDateTime,
  formatPercent,
  formatScore,
} from '@/lib/format';
import type { AuditEntry } from '@/lib/types';

import { DecisionForm } from './decision-form';

export const metadata = { title: 'İhbar incelemesi' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const DEV_ACTOR_NAMES = new Map<string, string>(
  Object.values(DEV_USERS).map((user) => [user.sub, user.name]),
);

const ACTION_LABELS: Record<string, string> = {
  'report.created': 'İhbar oluşturuldu',
  'report.status_changed': 'Durum değişti',
  'report.decision.manual': 'Manuel karar',
  'report.decision.auto': 'Otomatik karar',
  'report.anonymized': 'Anonimleştirildi',
  'report.retention_purged': 'Saklama süresi doldu',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function payloadSummary(entry: AuditEntry): string {
  const payload = entry.payload ?? {};
  const note = typeof payload.note === 'string' ? payload.note : null;
  if (note) return note;
  const keys = Object.keys(payload);
  if (keys.length === 0) return '—';
  return JSON.stringify(payload);
}

function actorLabel(actorId: string | null): string {
  if (!actorId) return 'Sistem';
  return DEV_ACTOR_NAMES.get(actorId) ?? `${actorId.slice(0, 8)}…`;
}

/** AI analiz hattının tanılama özetini (kaynak, tespit, gerekçe) çıkarır. */
function aiSummary(report: {
  modelVersion: string | null;
  aiMetadata: Record<string, unknown> | null;
}): { source: string; detections: string; reasons: string } {
  const meta = report.aiMetadata ?? {};
  const source = typeof meta.source === 'string' ? meta.source : 'bilinmiyor';
  const detections = Array.isArray(meta.detections)
    ? `${meta.detections.length} tespit`
    : '—';
  const reasons = Array.isArray(meta.reasons) && meta.reasons.length > 0
    ? meta.reasons.map((reason) => String(reason)).join(', ')
    : '—';

  return { source, detections, reasons };
}

export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireReviewer();
  const { id } = await params;
  const sp = await searchParams;
  const success = first(sp.ok) === '1';

  let report: Awaited<ReturnType<typeof getReport>>;
  let audit: Awaited<ReturnType<typeof getAudit>>;
  let meta: Awaited<ReturnType<typeof getMeta>>;

  try {
    [report, audit, meta] = await Promise.all([getReport(id), getAudit(id, { limit: 50 }), getMeta()]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <>
        <PageHeader title="İhbar incelemesi" />
        <ApiErrorPanel error={error} title="İhbar yüklenemedi" />
      </>
    );
  }

  const privileged = canViewOriginal(user.role);
  const requestedView = first(sp.view) === 'original' ? 'original' : 'anonymized';
  const originalImage = report.images.find((image) => image.kind === 'original');
  const anonymizedImage = report.images.find((image) => image.kind === 'anonymized');
  const view = requestedView === 'original' && privileged && originalImage ? 'original' : 'anonymized';
  const image = view === 'original' ? originalImage : anonymizedImage;
  const imageKind = view === 'original' ? 'original' : 'anonymized';
  const ai = aiSummary(report);

  return (
    <>
      <PageHeader
        title="İhbar incelemesi"
        description={`${VIOLATION_LABELS[report.violationType]} · ${formatDateTime(report.capturedAt)}`}
        actions={
          <Link href="/review" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Kuyruğa dön
          </Link>
        }
      />

      {success ? (
        <div role="status" className="mb-6 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          Karar kaydedildi ve denetim kaydına yazıldı.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Görsel</CardTitle>
              <CardDescription>
                {view === 'original'
                  ? 'Orijinal görsel (yalnızca yetkili roller görür)'
                  : 'Anonimleştirilmiş görsel (varsayılan)'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/review/${report.id}`}
                className={buttonVariants({ variant: view === 'anonymized' ? 'secondary' : 'outline', size: 'sm' })}
                aria-current={view === 'anonymized' ? 'true' : undefined}
              >
                Anonim
              </Link>
              {privileged && originalImage ? (
                <Link
                  href={`/review/${report.id}?view=original`}
                  className={buttonVariants({ variant: view === 'original' ? 'secondary' : 'outline', size: 'sm' })}
                  aria-current={view === 'original' ? 'true' : undefined}
                >
                  Orijinal
                </Link>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {image ? (
              <figure className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/reports/${report.id}/images/${imageKind}`}
                  alt={`İhbar görseli (${view === 'original' ? 'orijinal' : 'anonimleştirilmiş'})`}
                  className="max-h-[520px] w-full rounded-md border border-border bg-muted object-contain"
                />
                <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={view === 'original' ? 'danger' : 'success'}>
                    {view === 'original' ? 'Orijinal · KVKK kısıtlı' : 'Anonimleştirilmiş'}
                  </Badge>
                  {image.blurApplied ? <Badge variant="outline">Bulanıklaştırma uygulandı</Badge> : null}
                  <span>
                    {image.width && image.height ? `${image.width}×${image.height} · ` : ''}
                    {image.byteSize ? `${Math.round(image.byteSize / 1024)} KB` : ''}
                  </span>
                </figcaption>
              </figure>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-6 py-16 text-center">
                <ImageOff aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Görsel bulunamadı</p>
                <p className="text-xs text-muted-foreground">
                  Bu kayıt için {view === 'original' ? 'orijinal' : 'anonimleştirilmiş'} görsel
                  saklanmıyor olabilir veya saklama süresi dolmuş olabilir.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>H3: <code className="rounded bg-muted px-1.5 py-0.5">{report.h3.cell ?? 'yok'}</code> (çözünürlük {report.h3.resolution})</span>
              <span>·</span>
              <span>
                Konum: {report.location.latitude.toFixed(5)}, {report.location.longitude.toFixed(5)}
                {report.location.accuracyM ? ` (±${Math.round(report.location.accuracyM)} m)` : ''}
              </span>
              <a
                href={`https://www.openstreetmap.org/?mlat=${report.location.latitude}&mlon=${report.location.longitude}#map=18/${report.location.latitude}/${report.location.longitude}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                Haritada aç <ExternalLink aria-hidden="true" className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Ön değerlendirme</CardTitle>
              <CardDescription>Yapay zekâ ve kural tabanlı sonuçlar</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Durum</dt>
                  <dd className="mt-1">
                    <StatusBadge status={report.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Karar</dt>
                  <dd className="mt-1 font-medium">
                    {report.decision ? DECISION_LABELS[report.decision] : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Güven skoru</dt>
                  <dd className="mt-1 font-semibold tabular-nums">
                    {formatScore(report.confidenceScore)} · {formatPercent(report.confidenceScore)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Şiddet</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{report.severity ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Eşikler</dt>
                  <dd className="mt-1 tabular-nums">
                    {meta.thresholds.manualReview.toFixed(2)} – {meta.thresholds.autoAccept.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Kuyruk yaşı</dt>
                  <dd className="mt-1">{formatAge(report.capturedAt)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Skor kaynağı</dt>
                  <dd className="mt-1">
                    <span className="font-medium">{report.modelVersion ?? '—'}</span>
                    <span className="ml-2 text-muted-foreground">· {ai.source}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ai.detections} · {ai.reasons}
                    </span>
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Açıklama</dt>
                  <dd className="mt-1">{report.description ?? '—'}</dd>
                </div>
                {report.duplicateOf ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Olası tekrar</dt>
                    <dd className="mt-1">
                      <Link href={`/review/${report.duplicateOf}`} className="text-primary underline-offset-4 hover:underline">
                        {report.duplicateOf}
                      </Link>{' '}
                      (benzerlik {formatScore(report.duplicateScore)})
                    </dd>
                  </div>
                ) : null}
                <div className="col-span-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Alındı: {formatDateTime(report.receivedAt)} · Saklama bitişi:{' '}
                  {formatDateTime(report.retentionExpiresAt)}
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Karar</CardTitle>
              <CardDescription>
                Karar, gerekçesi ve kullanıcı bilgisi değiştirilemez denetim kaydına yazılır.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DecisionForm reportId={report.id} currentDecision={report.decision} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Denetim kaydı</CardTitle>
            <CardDescription>
              {audit.total} kayıt · yalnızca ekleme yapılabilir
            </CardDescription>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
            Değiştirilemez
          </span>
        </CardHeader>
        <CardContent>
          {audit.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kayıt yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <caption className="sr-only">İhbar denetim kayıtları</caption>
                <thead>
                  <tr>
                    <th scope="col">Zaman</th>
                    <th scope="col">Eylem</th>
                    <th scope="col">Durum değişimi</th>
                    <th scope="col" className="hidden md:table-cell">Aktör</th>
                    <th scope="col" className="hidden lg:table-cell">Ayrıntı</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.items.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="font-medium">{actionLabel(entry.action)}</td>
                      <td>
                        {entry.fromStatus || entry.toStatus ? (
                          <span className="text-xs">
                            {entry.fromStatus ? STATUS_LABELS[entry.fromStatus] : '—'} →{' '}
                            {entry.toStatus ? STATUS_LABELS[entry.toStatus] : '—'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="hidden md:table-cell">{actorLabel(entry.actorId)}</td>
                      <td className="hidden max-w-md truncate lg:table-cell" title={payloadSummary(entry)}>
                        {payloadSummary(entry)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
