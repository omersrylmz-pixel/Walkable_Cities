import { describe, expect, it } from 'vitest';

import { csvCell, toCsv } from './csv';

describe('CSV üretimi', () => {
  it('noktalı virgül ayırıcısı ve UTF-8 BOM ekler', () => {
    const csv = toCsv(['Ad', 'Değer'], [['Kaldırım', 3]]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Ad;Değer');
    expect(csv).toContain('Kaldırım;3');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('ayırıcı, tırnak ve satır sonu içeren hücreleri kaçışlar', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('formül enjeksiyonunu etkisizleştirir', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Sayısal değerler metin kaçışına takılmaz.
    expect(csvCell(-5)).toBe('-5');
  });

  it('boş ve geçersiz sayısal değerleri boş hücreye çevirir', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });
});
