import { toCsv, type CsvValue } from './csv';
import { STATUS_LABELS, VIOLATION_LABELS, formatDateTime } from './format';
import type { ReportSummaryDto } from './types';

/** Tek bir dışa aktarmada en fazla bu kadar kayıt indirilir. */
export const REPORT_EXPORT_MAX_ROWS = 5_000;

export const REPORT_CSV_HEADERS = [
  'İhbar No',
  'İhlal türü',
  'Durum',
  'Güven skoru',
  'Şiddet',
  'Enlem',
  'Boylam',
  'H3 hücresi',
  'Açıklama',
  'Yakalandı',
  'Alındı',
  'Görsel sayısı',
  'Karar',
  'Mükerrer kayıt',
] as const;

/** Panelde gösterilen özet kayıtları, belediye personeli için CSV'ye çevirir. */
export function buildReportsCsv(items: readonly ReportSummaryDto[]): string {
  const rows: CsvValue[][] = items.map((report) => [
    report.id,
    VIOLATION_LABELS[report.violationType],
    STATUS_LABELS[report.status],
    report.confidenceScore,
    report.severity,
    report.location.latitude,
    report.location.longitude,
    report.h3.cell,
    report.description,
    formatDateTime(report.capturedAt),
    formatDateTime(report.receivedAt),
    report.imageCount,
    report.decision,
    report.duplicateOf,
  ]);

  return toCsv(REPORT_CSV_HEADERS, rows);
}
