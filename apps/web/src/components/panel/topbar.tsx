'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, type Role } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

import { isActivePath, pageTitle, visibleNavItems } from './nav';

export function Topbar({
  user,
}: {
  user: { name: string; email: string; role: Role };
}) {
  const pathname = usePathname();
  const items = visibleNavItems(user.role);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold sm:text-lg">{pageTitle(pathname)}</h1>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-5">{user.name}</p>
            <Badge variant="info" className="mt-0.5">
              {ROLE_LABELS[user.role]}
            </Badge>
          </div>
          <form action="/api/auth/logout" method="post">
            <Button type="submit" variant="outline" size="sm">
              <LogOut aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Çıkış</span>
              <span className="sr-only sm:hidden">Çıkış yap</span>
            </Button>
          </form>
        </div>
      </div>

      <nav aria-label="Mobil menü" className="border-t border-border lg:hidden">
        <ul className="flex gap-1 overflow-x-auto px-2 py-1.5">
          {items.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
                    active
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
