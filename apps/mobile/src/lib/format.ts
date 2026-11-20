/** Tarihi cihaz saat diliminde `GG.AA.YYYY SS:dd` biçiminde gösterir. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatAccuracy(accuracyM: number | null | undefined): string {
  if (accuracyM === null || accuracyM === undefined) {
    return 'GPS yok';
  }
  return `±${Math.round(accuracyM)} m`;
}
