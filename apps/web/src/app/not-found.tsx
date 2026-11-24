import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">404</p>
      <h1 className="text-2xl font-bold">Sayfa bulunamadı</h1>
      <p className="text-muted-foreground">
        Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.
      </p>
      <div>
        <Link href="/dashboard" className={buttonVariants()}>
          Panele dön
        </Link>
      </div>
    </main>
  );
}
