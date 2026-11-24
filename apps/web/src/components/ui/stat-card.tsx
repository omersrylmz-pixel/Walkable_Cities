import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'warning' | 'success' | 'danger';
}) {
  const toneClasses = {
    default: 'bg-secondary text-secondary-foreground',
    warning: 'bg-amber-100 text-amber-900',
    success: 'bg-emerald-100 text-emerald-900',
    danger: 'bg-red-100 text-red-900',
  } as const;

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-lg', toneClasses[tone])}>
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
