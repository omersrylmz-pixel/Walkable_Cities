'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { ROLE_LABELS, type Role } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';

import { isActivePath, visibleNavItems } from './nav';

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = visibleNavItems(role);

  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-card lg:flex">
      <div className="flex items-center gap-3 border-b border-border px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Yaya Paneli</p>
          <p className="truncate text-xs text-muted-foreground">Belediye yönetimi</p>
        </div>
      </div>

      <nav aria-label="Ana menü" className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-start gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-secondary font-semibold text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block leading-5">{item.label}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-4">
        <Badge variant="outline" className="w-full justify-center">
          {ROLE_LABELS[role]}
        </Badge>
        <p className="mt-2 text-center text-xs text-muted-foreground">Faz 4 · v0.1.0</p>
      </div>
    </aside>
  );
}
