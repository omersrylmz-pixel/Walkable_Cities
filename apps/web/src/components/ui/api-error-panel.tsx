import { AlertTriangle } from 'lucide-react';

import { ApiError } from '@/lib/api-client';

export function ApiErrorPanel({ error, title = 'Veriler alınamadı' }: { error: unknown; title?: string }) {
  const isApiError = error instanceof ApiError;
  const message =
    error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu. Lütfen tekrar deneyin.';
  const isUnavailable = isApiError && error.status === 503;

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-2">
          <p className="font-semibold">{title}</p>
          <p className="text-sm">{message}</p>
          {isUnavailable ? (
            <p className="text-sm">
              API servisini başlatmak için proje kökünde{' '}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                npm run stack:up
              </code>{' '}
              komutunu çalıştırın.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
