import {
  Activity,
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  Inbox,
} from 'lucide-react';
import Link from 'next/link';

import { StatusBadge } from '@/components/reports/status-badge';
import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { getMeta, listReports } from '@/lib/api-client';
import { canReview } from '@/lib/auth/roles';
import { requireUser } from '@/lib/auth/server';
import {
  VIOLATION_LABELS,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatScore,
} from '@/lib/format';
import type { ReportSummaryDto, ViolationType } from '@/lib/types';

export const metadata = { title: 'Panel' };
export const dynamic = 'force-dynamic';

const istanbulDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function sameIstanbulDay(value: string, now: Date): boolean {
  return istanbulDay.format(new Date(value)) === istanbulDay.format(now);
}

function averageAgeHours(items: ReportSummaryDto[], now: Date): number | null {
  if (items.length === 0) return null;
  const totalMs = items.reduce((sum, item) => {
    const captured = new Date(item.capturedAt).getTime();
    return sum + Math.max(0, now.getTime() - captured);
  }, 0);
  return totalMs / items.length / 3_600_000;
}

async function loadDashboardData() {
  const [meta, all, pending, autoApproved, autoRejected, approved, rejected, recent] =
    await Promise.all([
      getMeta(),
      listReports({ limit: 1 }),
      listReports({ status: 'pending_review', limit: 1 }),
      listReports({ status: 'auto_approved', limit: 1 }),
      listReports({ status: 'auto_rejected', limit: 1 }),
      listReports({ status: 'approved', limit: 1 }),
      listReports({ status: 'rejected', limit: 1 }),
      listReports({ limit: 100, sort: 'recent' }),
    ]);

  return {
    meta,
    totals: {
      all: all.pagination.total,
      pending: pending.pagination.total,
      autoApproved: autoApproved.pagination.total,
      autoRejected: autoRejected.pagination.total,
      approved: approved.pagination.total,
      rejected: rejected.pagination.total,
    },
    recent: recent.items,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser('/dashboard');
  const params = await searchParams;
  const denied = params.denied === '1';

  let data: Awaited<ReturnType<typeof loadDashboardData>>;
  try {
    data = await loadDashboardData();
  } catch (error) {
    return (
      <>
        <PageHeader title="Panel" description="İhbar ve karar süreçlerinin özet göstergeleri." />
        <ApiErrorPanel error={error} title="Panel verileri alınamadı" />
      </>
    );
  }

  const now = new Date();
  const { totals, recent, meta } = data;
  const autoDecisions = totals.autoApproved + totals.autoRejected;
  const autoAcceptRate = autoDecisions > 0 ? totals.autoApproved / autoDecisions : null;
  const todayCount = recent.filter((item) => sameIstanbulDay(item.receivedAt, now)).length;
  const pendingItems = recent.filter((item) => item.status === 'pending_review');
  const avgQueueHours = averageAgeHours(pendingItems, now);
  const staleCount = pendingItems.filter(
    (item) => now.getTime() - new Date(item.capturedAt).getTime() > 48 * 3_600_000,
  ).length;

  const typeCounts = new Map<ViolationType, number>();
  for (const item of recent) {
    typeCounts.set(item.violationType, (typeCounts.get(item.violationType) ?? 0) + 1);
  }
  const typeRows = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxTypeCount = typeRows[0]?.[1] ?? 1;

  const reviewer = canReview(user.role);

  return (
    <>
      <PageHeader
        title={`Merhaba, ${user.name.split(' ')[0]}`}
        description="Son 100 ihbar üzerinden hesaplanan özet göstergeler. Ağır mekânsal analizler Faz 5'te sunucu tarafına taşınacak."
        actions={
          <Link href="/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Activity aria-hidden="true" className="h-4 w-4" />
            Yenile
          </Link>
        }
      />

      {denied ? (
        <div role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Bu işlem için yetkiniz bulunmuyor. Rolünüz: <strong>{user.role}</strong>.
        </div>
      ) : null}

      <section aria-label="Özet göstergeler" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam ihbar"
          value={formatNumber(totals.all)}
          hint={`Bugün gelen: ${formatNumber(todayCount)}`}
          icon={ClipboardList}
        />
        <StatCard
          label="İnceleme kuyruğu"
          value={formatNumber(totals.pending)}
          hint={
            avgQueueHours === null
              ? 'Kuyrukta kayıt yok'
              : `Ortalama yaş: ${avgQueueHours.toFixed(1)} sa · 48 saatten eski: ${staleCount}`
          }
          icon={Inbox}
          tone={totals.pending > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Otomatik kabul oranı"
          value={autoAcceptRate === null ? '—' : formatPercent(autoAcceptRate)}
          hint={`${formatNumber(totals.autoApproved)} kabul · ${formatNumber(totals.autoRejected)} ret`}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Manuel kararlar"
          value={formatNumber(totals.approved + totals.rejected)}
          hint={`${formatNumber(totals.approved)} onay · ${formatNumber(totals.rejected)} ret`}
          icon={FilePlus2}
          tone="default"
        />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Son ihbarlar</CardTitle>
              <CardDescription>En güncel 5 kayıt</CardDescription>
            </div>
            <Link href="/reports" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Tümünü gör
            </Link>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState
                title="Henüz ihbar yok"
                description="Mobil uygulamadan gönderilen ilk ihbar burada görünecek."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <caption className="sr-only">Son beş ihbar</caption>
                  <thead>
                    <tr>
                      <th scope="col">Tür</th>
                      <th scope="col">Durum</th>
                      <th scope="col">Skor</th>
                      <th scope="col">Alındı</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.slice(0, 5).map((report) => (
                      <tr key={report.id}>
                        <td>
                          <span className="font-medium">{VIOLATION_LABELS[report.violationType]}</span>
                          <span className="block text-xs text-muted-foreground">
                            {report.h3.cell ?? 'H3 yok'}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={report.status} />
                        </td>
                        <td className="tabular-nums">{formatScore(report.confidenceScore)}</td>
                        <td className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(report.receivedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Karar eşikleri</CardTitle>
              <CardDescription>Otomatik kabul / manuel inceleme sınırları</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Otomatik kabul</span>
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-600" />≥ {meta.thresholds.autoAccept.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Manuel inceleme</span>
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                  <AlarmClock aria-hidden="true" className="h-4 w-4 text-amber-600" />
                  {meta.thresholds.manualReview.toFixed(2)} – {meta.thresholds.autoAccept.toFixed(2)}
                </span>
              </div>
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Eşikler API tarafından yönetilir. Panelden düzenleme Faz 4 kapsamı dışında
                bırakıldı; yönetim ucu audit kaydıyla birlikte sonraki fazda eklenecek.
              </div>
              {reviewer ? (
                <Link href="/review" className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'w-full' })}>
                  İnceleme kuyruğuna git
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tür dağılımı</CardTitle>
              <CardDescription>Son 100 ihbar</CardDescription>
            </CardHeader>
            <CardContent>
              {typeRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Veri yok.</p>
              ) : (
                <ul className="space-y-3">
                  {typeRows.map(([type, count]) => (
                    <li key={type} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>{VIOLATION_LABELS[type]}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(6, (count / maxTypeCount) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Kuyruk yaşı, son 100 inceleme kaydının yakalanma zamanı üzerinden ortalamadır. Ağır
        agregasyonlar Faz 5'te API tarafına taşınacak.
      </p>
    </>
  );
}
