export const VIOLATION_TYPES = [
  { code: 'kaldirim_isgali', label: 'Kaldırım İşgali' },
  { code: 'yaya_gecidi_ihlali', label: 'Yaya Geçidi İhlali' },
  { code: 'sabit_engel', label: 'Sabit Engel' },
  { code: 'yuzey_bozulmasi', label: 'Yüzey Bozulması' },
  { code: 'gecici_engel', label: 'Geçici Engel' },
] as const;

export type ViolationType = (typeof VIOLATION_TYPES)[number]['code'];

export function violationLabel(code: ViolationType): string {
  return VIOLATION_TYPES.find((item) => item.code === code)?.label ?? code;
}

export type QueueStatus = 'pending' | 'uploading' | 'failed';

/**
 * Cihazda kalıcı olarak saklanan ihbar. Görsel, belge dizinindeki
 * `ihbar-kuyrugu/` klasöründe tutulur; yükleme başarılı olunca silinir.
 */
export interface QueueItem {
  clientReportId: string;
  violationType: ViolationType;
  capturedAt: string;
  createdAt: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  clockDriftSeconds: number | null;
  description: string | null;
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  mimeType: 'image/jpeg';
  status: QueueStatus;
  /** Kalıcı hata (4xx): otomatik yeniden denenmez. */
  retryable: boolean;
  attempts: number;
  lastError: string | null;
}

export interface CreateReportResponse {
  data: {
    id: string;
    clientReportId: string;
    duplicateOf: string | null;
  };
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracyM: number;
}
