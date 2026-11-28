/**
 * Excel'in Türkçe yerel ayarında varsayılan liste ayırıcısı noktalı virgüldür.
 * UTF-8 BOM, İ/ı/ş/ğ gibi karakterlerin bozulmadan açılmasını sağlar.
 */
const DELIMITER = ';';
const BOM = '\uFEFF';

export type CsvValue = string | number | null | undefined;

/** CSV formül enjeksiyonunu tetikleyen başlangıç karakterleri. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Tek bir hücreyi kaçışlar; tırnak, ayırıcı ve satır sonlarını korur. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }

  // Kullanıcı açıklaması "=" ile başlarsa Excel formül olarak çalıştırmasın.
  const text = FORMULA_PREFIX.test(value) ? `'${value}` : value;

  if (/[";\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Başlık ve satırlardan Excel uyumlu CSV metni üretir. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  const lines = [
    headers.map(csvCell).join(DELIMITER),
    ...rows.map((row) => row.map(csvCell).join(DELIMITER)),
  ];

  return `${BOM}${lines.join('\r\n')}\r\n`;
}
