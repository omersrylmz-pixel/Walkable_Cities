import { Sidebar } from '@/components/panel/sidebar';
import { Topbar } from '@/components/panel/topbar';
import { requireUser } from '@/lib/auth/server';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <Sidebar role={user.role} />
      <div className="flex min-h-screen min-w-0 flex-col">
        <Topbar user={{ name: user.name, email: user.email, role: user.role }} />
        <div id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
        <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground sm:px-6">
          Yaya Alanı İhlal Tespiti ve Şehir Analiz Platformu · TÜBİTAK 2209-A
        </footer>
      </div>
    </div>
  );
}
