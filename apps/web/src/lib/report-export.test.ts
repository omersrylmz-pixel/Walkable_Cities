import { describe, expect, it } from 'vitest';

import { REPORT_CSV_HEADERS, buildReportsCsv } from './report-export';
import type { ReportSummaryDto } from './types';

const report: ReportSummaryDto = {
  id: '3f5d1f9e-6f9f-4b3f-9d3b-6d1f9a2c4b7e',
  clientReportId: '8a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  violationType: 'kaldirim_isgali',
  violationLabel: 'Kaldırım İşgali',
  status: 'approved',
  decision: 'manual_accept',
  confidenceScore: 0.92,
  severity: 3,
  description: 'Kaldırım; kamyon tarafından kapatılmış',
  capturedAt: '2026-11-01T09:30:00.000Z',
  receivedAt: '2026-11-01T09:31:00.000Z',
  location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 6, source: 'device' },
  h3: { cell: '8826a1c9d1fffff', resolution: 9 },
  modelVersion: 'heuristic-1',
  aiMetadata: null,
  duplicateOf: null,
  duplicateScore: null,
  anonymizedAt: '2026-11-01T09:31:10.000Z',
  retentionExpiresAt: '2028-10-31T09:31:10.000Z',
  integrity: null,
  imageCount: 2,
  createdAt: '2026-11-01T09:31:10.000Z',
  updatedAt: '2026-11-01T09:31:10.000Z',
};

describe('İhbar CSV dışa aktarma', () => {
  it('Türkçe başlıkları ve etiketli değerleri yazar', () => {
    const csv = buildReportsCsv([report]);

    expect(csv).toContain(REPORT_CSV_HEADERS.join(';'));
    expect(csv).toContain('Kaldırım İşgali;Onaylandı;0.92');
    expect(csv).toContain(report.id);
  });

  it('ayırıcı içeren açıklamayı tırnaklar', () => {
    const csv = buildReportsCsv([report]);

    expect(csv).toContain('"Kaldırım; kamyon tarafından kapatılmış"');
  });

  it('boş kayıtta yalnızca başlık satırı üretir', () => {
    const csv = buildReportsCsv([]);
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(REPORT_CSV_HEADERS.join(';'));
  });
});
