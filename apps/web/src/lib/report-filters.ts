import {
  REPORT_STATUSES,
  VIOLATION_TYPES,
  type ListSort,
  type ReportStatus,
  type ViolationType,
} from './types';

/** Sayfa ve CSV dışa aktarma tarafından paylaşılan ihbar filtreleri. */
export interface ReportFilters {
  status?: ReportStatus;
  violationType?: ViolationType;
  sort: ListSort;
  minScore?: number;
  maxScore?: number;
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function pickStatus(value: string | undefined): ReportStatus | undefined {
  return value && (REPORT_STATUSES as readonly string[]).includes(value)
    ? (value as ReportStatus)
    : undefined;
}

export function pickViolation(value: string | undefined): ViolationType | undefined {
  return value && (VIOLATION_TYPES as readonly string[]).includes(value)
    ? (value as ViolationType)
    : undefined;
}

export function pickSort(value: string | undefined): ListSort {
  return value === 'score' ? 'score' : 'recent';
}

export function pickScore(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return undefined;
  return parsed;
}

export function pickOffset(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Adres çubuğu veya sorgu dizesindeki ham değerlerden doğrulanmış filtre
 * üretir. Geçersiz değerler sessizce yok sayılır; böylece elle düzenlenen
 * bağlantılar API'de 422 hatasına yol açmaz.
 */
export function parseReportFilters(get: (key: string) => string | undefined): ReportFilters {
  return {
    status: pickStatus(get('status')),
    violationType: pickViolation(get('violationType')),
    sort: pickSort(get('sort')),
    minScore: pickScore(get('minScore')),
    maxScore: pickScore(get('maxScore')),
  };
}
