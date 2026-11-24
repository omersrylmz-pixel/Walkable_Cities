import { describe, expect, it } from 'vitest';

import {
  formatAge,
  formatNumber,
  formatPercent,
  formatScore,
  statusTone,
} from './format';

describe('biçimlendirme yardımcıları', () => {
  it('yüzde ve skor biçimlendirir', () => {
    expect(formatPercent(0.856)).toBe('%86');
    expect(formatPercent(0.856, 1)).toBe('%85.6');
    expect(formatPercent(null)).toBe('—');
    expect(formatScore(0.6)).toBe('0.60');
    expect(formatScore(undefined)).toBe('—');
  });

  it('sayıları Türkçe ayraçla biçimlendirir', () => {
    expect(formatNumber(12345)).toBe('12.345');
    expect(formatNumber(null)).toBe('—');
  });

  it('kuyruk yaşını kısa biçimde döndürür', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(formatAge(new Date('2026-11-24T11:30:00Z'), now)).toBe('30 dk');
    expect(formatAge(new Date('2026-11-24T09:00:00Z'), now)).toBe('3 sa');
    expect(formatAge(new Date('2026-11-22T12:00:00Z'), now)).toBe('2 gün');
    expect(formatAge(new Date('2026-11-25T12:00:00Z'), now)).toBe('—');
  });

  it('durumları renk tonlarına eşler', () => {
    expect(statusTone('pending_review')).toBe('warning');
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('auto_rejected')).toBe('danger');
    expect(statusTone('processing')).toBe('info');
    expect(statusTone('draft')).toBe('outline');
  });
});
