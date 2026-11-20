import { Platform } from 'react-native';

import { API_URL, APP_VERSION } from './config';
import type { CreateReportResponse, QueueItem } from './types';

/**
 * API'den dönen hata. `retryable` false ise istek aynı gövdeyle tekrar
 * denenmemelidir (doğrulama hatası gibi).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Ağ/timeout hataları yeniden denenebilir; 4xx hataları genellikle değildir. */
function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * İhbarı `multipart/form-data` olarak gönderir.
 * Sunucu idempotent olduğu için aynı `clientReportId` ile tekrar denemek güvenlidir.
 */
export async function postReport(item: QueueItem): Promise<CreateReportResponse['data']> {
  const form = new FormData();

  form.append(
    'report',
    JSON.stringify({
      clientReportId: item.clientReportId,
      violationType: item.violationType,
      capturedAt: item.capturedAt,
      location: {
        latitude: item.latitude,
        longitude: item.longitude,
        accuracyM: item.accuracyM,
        source: 'device',
      },
      device: {
        platform: detectPlatform(),
        appVersion: APP_VERSION,
        clockDriftSeconds: item.clockDriftSeconds ?? undefined,
      },
      description: item.description ?? undefined,
    }),
  );

  // React Native FormData dosya parçası: { uri, name, type }
  form.append('image', {
    uri: item.imageUri,
    name: `${item.clientReportId}.jpg`,
    type: item.mimeType,
  } as unknown as Blob);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1/reports`, {
      method: 'POST',
      body: form,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new ApiError(
      `Sunucuya ulaşılamadı: ${describeError(error)}`,
      null,
      true,
      'NETWORK_ERROR',
    );
  }

  const payload = await safeJson(response);

  if (!response.ok) {
    const detail =
      (payload as { detail?: string } | null)?.detail ?? `HTTP ${response.status}`;
    const code = (payload as { code?: string } | null)?.code ?? null;
    throw new ApiError(detail, response.status, isRetryableStatus(response.status), code);
  }

  const data = (payload as CreateReportResponse | null)?.data;
  if (!data?.id) {
    throw new ApiError('Sunucu yanıtı beklenen biçimde değil', response.status, true);
  }

  return data;
}

/**
 * Sunucu `Date` başlığı ile cihaz saati arasındaki farkı saniye cinsinden
 * ölçer. Başlık saniye çözünürlüğündedir; ağ gecikmesi hesaba katılmaz.
 */
export async function measureClockDriftSeconds(): Promise<number | null> {
  try {
    const response = await fetch(`${API_URL}/health`, { method: 'GET' });
    const header = response.headers.get('date');
    if (!header) {
      return null;
    }

    const serverMs = Date.parse(header);
    if (Number.isNaN(serverMs)) {
      return null;
    }

    return Math.round((serverMs - Date.now()) / 1000);
  } catch {
    return null;
  }
}

function detectPlatform(): 'android' | 'ios' | 'web' | 'unknown' {
  const os = Platform.OS;
  if (os === 'android' || os === 'ios' || os === 'web') {
    return os;
  }
  return 'unknown';
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'bilinmeyen hata';
}
