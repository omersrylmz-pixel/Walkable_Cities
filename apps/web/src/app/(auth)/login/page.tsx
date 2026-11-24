import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEV_USERS, getSupabaseConfig, isDevAuthEnabled } from '@/lib/auth/dev-users';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/auth/roles';
import { getSessionUser } from '@/lib/auth/server';

export const metadata = { title: 'Giriş' };

function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const session = await getSessionUser();
  if (session) redirect('/dashboard');

  const params = await searchParams;
  const next = safeNext(params.next);
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const devMode = isDevAuthEnabled();
  const supabase = getSupabaseConfig();
  const devUsers = Object.entries(DEV_USERS) as [keyof typeof DEV_USERS, (typeof DEV_USERS)[keyof typeof DEV_USERS]][];

  return (
    <main id="main" className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section
        aria-labelledby="brand-title"
        className="hidden flex-col justify-between bg-gradient-to-br from-sky-950 via-sky-900 to-teal-800 p-10 text-white lg:flex"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck aria-hidden="true" className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-medium text-sky-200">TÜBİTAK 2209-A</p>
            <p className="text-lg font-semibold">Yaya Alanı İhlal Platformu</p>
          </div>
        </div>

        <div className="max-w-md space-y-4">
          <h1 id="brand-title" className="text-3xl font-bold leading-tight">
            İhbarları inceleyin, kenti birlikte erişilebilir kılın.
          </h1>
          <p className="text-sky-100">
            Yapay zekâ destekli ön değerlendirme, manuel inceleme kuyruğu ve H3 tabanlı
            mekânsal analizler tek panelde.
          </p>
          <ul className="space-y-2 text-sm text-sky-100">
            <li>• KVKK uyumlu anonimleştirilmiş görseller</li>
            <li>• Değiştirilemez denetim izi (audit log)</li>
            <li>• Rol bazlı erişim: yönetici, moderatör, izleyici</li>
          </ul>
        </div>

        <p className="text-xs text-sky-200/80">
          Belediye personeli için geliştirilmiştir. Yetkisiz erişim girişimleri kayıt altına alınır.
        </p>
      </section>

      <section className="flex items-center justify-center bg-background p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-bold tracking-tight">Panele giriş</h2>
            <p className="text-sm text-muted-foreground">
              Belediye hesabınızla oturum açın. Oturum 8 saat geçerlidir.
            </p>
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{devMode ? 'Geliştirme oturumu' : 'Kurumsal giriş'}</CardTitle>
              <CardDescription>
                {devMode
                  ? 'Supabase yapılandırılmadığı için demo rollerle giriş yapabilirsiniz. Bu mod üretimde kullanılamaz.'
                  : 'Belediye Supabase hesabınızla giriş yapın.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {devMode ? (
                <form action="/api/auth/login" method="post" className="space-y-3">
                  <input type="hidden" name="next" value={next} />
                  <fieldset className="space-y-3">
                    <legend className="sr-only">Demo kullanıcı seçin</legend>
                    {devUsers.map(([key, user]) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                      >
                        <input
                          type="radio"
                          name="devUser"
                          value={key}
                          defaultChecked={key === 'moderator'}
                          className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        <span className="space-y-0.5">
                          <span className="block text-sm font-medium">
                            {user.name} · {ROLE_LABELS[user.role]}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {ROLE_DESCRIPTIONS[user.role]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <Button type="submit" className="w-full">
                    Demo kullanıcıyla giriş yap
                  </Button>
                </form>
              ) : supabase ? (
                <form action="/api/auth/login" method="post" className="space-y-4">
                  <input type="hidden" name="next" value={next} />
                  <div className="space-y-2">
                    <Label htmlFor="email">E-posta</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      required
                      placeholder="ad.soyad@belediye.gov.tr"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Parola</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    Giriş yap
                  </Button>
                </form>
              ) : (
                <div role="alert" className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Giriş yapılandırılmamış.</p>
                  <p>
                    Üretimde <code className="rounded bg-muted px-1">SUPABASE_URL</code> ve{' '}
                    <code className="rounded bg-muted px-1">SUPABASE_ANON_KEY</code> tanımlayın.
                    Geliştirme için <code className="rounded bg-muted px-1">WEB_DEV_AUTH=true</code>{' '}
                    ayarlayabilirsiniz.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Orijinal görseller yalnızca yetkili rollere gösterilir; varsayılan görünüm
            anonimleştirilmiş kopyadır.
          </p>
        </div>
      </section>
    </main>
  );
}
