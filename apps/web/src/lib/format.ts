import type { DecisionOutcome, ReportStatus, ViolationType } from './types';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

const dayFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeZone: 'Europe/Istanbul',
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dayFormatter.format(date);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `%${(value * 100).toFixed(digits)}`;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('tr-TR').format(value);
}

export function formatAge(from: string | Date, now: Date = new Date()): string {
  const start = typeof from === 'string' ? new Date(from) : from;
  const diffMs = now.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '—';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa`;
  return `${Math.floor(hours / 24)} gün`;
}

export const STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Taslak',
  queued: 'Kuyrukta',
  processing: 'İşleniyor',
  auto_approved: 'Otomatik kabul',
  pending_review: 'İncelemede',
  auto_rejected: 'Otomatik ret',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  failed: 'Başarısız',
};

export const DECISION_LABELS: Record<DecisionOutcome, string> = {
  auto_accept: 'Otomatik kabul',
  manual_review: 'Manuel inceleme',
  auto_reject: 'Otomatik ret',
  manual_accept: 'Manuel kabul',
  manual_reject: 'Manuel ret',
};

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  kaldirim_isgali: 'Kaldırım İşgali',
  yaya_gecidi_ihlali: 'Yaya Geçidi İhlali',
  sabit_engel: 'Sabit Engel',
  yuzey_bozulmasi: 'Yüzey Bozulması',
  gecici_engel: 'Geçici Engel',
};

export function statusTone(
  status: ReportStatus,
): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline' {
  switch (status) {
    case 'auto_approved':
    case 'approved':
      return 'success';
    case 'pending_review':
      return 'warning';
    case 'auto_rejected':
    case 'rejected':
    case 'failed':
      return 'danger';
    case 'processing':
    case 'queued':
      return 'info';
    default:
      return 'outline';
  }
}
