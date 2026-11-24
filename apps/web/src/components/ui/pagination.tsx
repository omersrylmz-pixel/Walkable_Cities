import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Pagination({
  total,
  limit,
  offset,
  basePath,
  params = {},
}: {
  total: number;
  limit: number;
  offset: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  if (total === 0) return null;

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  const hrefFor = (nextOffset: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, value);
    }
    if (nextOffset > 0) search.set('offset', String(nextOffset));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav
      aria-label="Sayfalama"
      className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row"
    >
      <p className="text-sm text-muted-foreground">
        Toplam <span className="font-medium text-foreground">{total}</span> kayıt · Sayfa{' '}
        <span className="font-medium text-foreground">{page}</span> / {pageCount}
      </p>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link href={hrefFor(Math.max(0, offset - limit))} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Önceki
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}>
            Önceki
          </span>
        )}
        {hasNext ? (
          <Link href={hrefFor(offset + limit)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
            Sonraki
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'pointer-events-none opacity-50')}>
            Sonraki
          </span>
        )}
      </div>
    </nav>
  );
}
