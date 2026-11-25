import { History, ShieldCheck, SlidersHorizontal, UserRound } from 'lucide-react';

import { ApiErrorPanel } from '@/components/ui/api-error-panel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getSettings, getSystemAudit } from '@/lib/api-client';
import { requireAdmin } from '@/lib/auth/server';
import { formatDateTime } from '@/lib/format';
import type { SystemAuditEntry } from '@/lib/types';

import { PrivacyForm, ThresholdForm } from './settings-forms';

export const metadata = { title: 'Ayarlar' };
export const dynamic = 'force-dynamic';

const DEV_ACTOR_NAMES = new Map<string, string>([
  ['11111111-1111-4111-8111-111111111111', 'Belediye yöneticisi'],
  ['22222222-2222-4222-8222-222222222222', 'Moderatör'],
  ['33333333-3333-4333-8333-333333333333', 'İzleyici'],
]);

const ACTION_LABELS: Record<string, string> = {
  'settings.thresholds.updated': 'Karar eşikleri güncellendi',
  'settings.privacy.updated': 'KVKK politikası güncellendi',
};

function actorLabel(actorId: string | null): string {
  if (!actorId) return 'Sistem';
  return DEV_ACTOR_NAMES.get(actorId) ?? `${actorId.slice(0, 8)}…`;
}

function valueSummary(entry: SystemAuditEntry): string {
  const keys = Object.keys(entry.after ?? {});
  if (keys.length === 0) return '—';
  return keys
    .map((key) => {
      const value = entry.after[key];
      const label =
        typeof value === 'boolean' ? (value ? 'açık' : 'kapalı') : String(value);
      return `${key}: ${label}`;
    })
    .join(' · ');
}

export default async function SettingsPage() {
  const user = await requireAdmin('/settings');

  let settings: Awaited<ReturnType<typeof getSettings>>;
  let audit: Awaited<ReturnType<typeof getSystemAudit>>;

  try {
    [settings, audit] = await Promise.all([
      getSettings(user.sub),
      getSystemAudit(user.sub, { limit: 50 }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader title="Ayarlar" description="Karar eşikleri, KVKK politikası ve denetim izi." />
        <ApiErrorPanel error={error} title="Ayarlar yüklenemedi" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Karar eşikleri ve KVKK politikası yalnızca belediye yöneticisi tarafından değiştirilebilir; her değişiklik değiştirilemez denetim kaydına yazılır."
        actions={
          <Badge variant="outline">
            <UserRound aria-hidden="true" className="h-3.5 w-3.5" />
            {user.name}
          </Badge>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <SlidersHorizontal aria-hidden="true" className="mt-1 h-5 w-5 text-primary" />
            <div className="space-y-1">
              <CardTitle>Karar eşikleri</CardTitle>
              <CardDescription>
                AI skorunun otomatik karara bağlandığı sınırlar (0–1).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ThresholdForm settings={settings} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <ShieldCheck aria-hidden="true" className="mt-1 h-5 w-5 text-primary" />
            <div className="space-y-1">
              <CardTitle>KVKK / saklama politikası</CardTitle>
              <CardDescription>
                Görsellerin saklama süresi ve anonimleştirme zorunluluğu.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <PrivacyForm settings={settings} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Sistem denetim kaydı</CardTitle>
            <CardDescription>
              {audit.total} kayıt · yalnızca ekleme yapılabilir
            </CardDescription>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <History aria-hidden="true" className="h-3.5 w-3.5" />
            Son 50 değişiklik
          </span>
        </CardHeader>
        <CardContent>
          {audit.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz ayar değişikliği yok. İlk eşik veya KVKK güncellemesi burada görünecek.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <caption className="sr-only">Sistem ayarları denetim kaydı</caption>
                <thead>
                  <tr>
                    <th scope="col">Zaman</th>
                    <th scope="col">Değişiklik</th>
                    <th scope="col" className="hidden md:table-cell">Aktör</th>
                    <th scope="col" className="hidden lg:table-cell">Anahtar</th>
                    <th scope="col" className="hidden lg:table-cell">Yeni değer</th>
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
                      <td className="hidden md:table-cell">{actorLabel(entry.actorId)}</td>
                      <td className="hidden lg:table-cell">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {entry.targetKey ?? '—'}
                        </code>
                      </td>
                      <td className="hidden max-w-sm truncate lg:table-cell" title={valueSummary(entry)}>
                        {valueSummary(entry)}
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
