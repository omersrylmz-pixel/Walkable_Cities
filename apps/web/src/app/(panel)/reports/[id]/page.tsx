import { ArrowLeft, ExternalLink, ImageOff, ShieldCheck } from 'lucide-react';
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
import { canReview, canViewOriginal } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';
import {
  DECISION_LABELS,
  STATUS_LABELS,
  VIOLATION_LABELS,
  formatAge,
  formatDateTime,
  formatPercent,
  formatScore,
} from '@/lib/format';
import type { AuditEntry, ReportDto } from '@/lib/types';

export const metadata = { title: 'İhbar detayı' };
export const dynamic = 'force-dynamic';

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

function actorLabel(actorId: string | null): string {
  if (!actorId) return 'Sistem';
  return DEV_ACTOR_NAMES.get(actorId) ?? `${actorId.slice(0, 8)}…`;
}

function payloadSummary(entry: AuditEntry): string {
  const payload = entry.payload ?? {};
  const note = typeof payload.note === 'string' ? payload.note : null;
  if (note) return note;
  const keys = Object.keys(payload);
  if (keys.length === 0) return '—';
  return JSON.stringify(payload);
}

function metadataRows(report: ReportDto): Array<{ label: string; value: string }> {
  const analysis =
    report.aiMetadata && typeof report.aiMetadata === 'object'
      ? (report.aiMetadata as Record<string, unknown>)
      : {};

  const source = typeof analysis.source === 'string' ? analysis.source : '—';
  const detections = Array.isArray(analysis.detections)
    ? String(analysis.detections.length)
    : '—';
  const reasons = Array.isArray(analysis.reasons)
    ? (analysis.reasons as unknown[]).join(', ') || '—'
    : '—';

  return [
    { label: 'Skor kaynağı', value: source },
    { label: 'Model sürümü', value: report.modelVersion ?? '—' },
    { label: 'Tespit sayısı', value: detections },
    { label: 'Gerekçeler', value: reasons },
  ];
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser('/reports');
  const { id } = await params;

  let report: Awaited<ReturnType<typeof getReport>>;
  let audit: Awaited<ReturnType<typeof getAudit>>;
  let meta: Awaited<ReturnType<typeof getMeta>>;

  try {
    [report, audit, meta] = await Promise.all([getReport(id), getAudit(id, { limit: 50 }), getMeta()]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <>
        <PageHeader title="İhbar detayı" />
        <ApiErrorPanel error={error} title="İhbar yüklenemedi" />
      </>
    );
  }

  const privileged = canViewOriginal(user.role);
  const reviewer = canReview(user.role);
  const originalImage = report.images.find((image) => image.kind === 'original');
  const anonymizedImage = report.images.find((image) => image.kind === 'anonymized');
  // KVKK: yalnızca yetkili roller orijinali görebilir; diğerleri anonimleştirilmiş görsele düşer.
  const image = privileged && originalImage ? originalImage : anonymizedImage;
  const imageKind = image?.kind ?? 'anonymized';

  return (
    <>
      <PageHeader
        title="İhbar detayı"
        description={`${VIOLATION_LABELS[report.violationType]} · ${formatDateTime(report.capturedAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/reports" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Listeye dön
            </Link>
            {reviewer ? (
              <Link href={`/review/${report.id}`} className={buttonVariants({ size: 'sm' })}>
                İncelemeye git
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Görsel</CardTitle>
              <CardDescription>
                {imageKind === 'original'
                  ? 'Orijinal görsel (yetkili rol)'
                  : 'Anonimleştirilmiş görsel (KVKK)'}
              </CardDescription>
            </div>
            <Badge variant={imageKind === 'original' ? 'danger' : 'success'}>
              {imageKind === 'original' ? 'Orijinal' : 'Anonimleştirilmiş'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {image ? (
              <figure className="space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/reports/${report.id}/images/${imageKind}`}
                  alt={`İhbar görseli (${imageKind === 'original' ? 'orijinal' : 'anonimleştirilmiş'})`}
                  className="max-h-[520px] w-full rounded-md border border-border bg-muted object-contain"
                />
                <figcaption className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                  Saklama süresi dolmuş veya görsel anonimleştirmede kaldırılmış olabilir.
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>
                H3: <code className="rounded bg-muted px-1.5 py-0.5">{report.h3.cell ?? 'yok'}</code>{' '}
                (çözünürlük {report.h3.resolution})
              </span>
              <span>·</span>
              <span>
                Konum: {report.location.latitude.toFixed(5)}, {report.location.longitude.toFixed(5)}
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
              <CardTitle>Özet</CardTitle>
              <CardDescription>Salt okunur görünüm; karar değiştirilemez</CardDescription>
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
                  <dt className="text-muted-foreground">Açıklama</dt>
                  <dd className="mt-1">{report.description ?? '—'}</dd>
                </div>
                <div className="col-span-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Alındı: {formatDateTime(report.receivedAt)} · Saklama bitişi:{' '}
                  {formatDateTime(report.retentionExpiresAt)}
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI analiz özeti</CardTitle>
              <CardDescription>Güven skorunu üreten hat ve gerekçeler</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {metadataRows(report).map((row) => (
                  <div key={row.label} className="col-span-2 sm:col-span-1">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="mt-1 break-words">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Denetim kaydı</CardTitle>
            <CardDescription>{audit.total} kayıt · yalnızca ekleme yapılabilir</CardDescription>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            Salt okunur
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
                      <td className="font-medium">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </td>
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
