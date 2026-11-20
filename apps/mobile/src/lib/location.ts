import * as Location from 'expo-location';

import { TARGET_GPS_ACCURACY_M } from './config';
import type { GeoFix } from './types';

export class LocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationError';
  }
}

export async function requestLocationAccess(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export interface AcquireFixOptions {
  targetAccuracyM?: number;
  attempts?: number;
  timeoutMs?: number;
}

/**
 * Hedef doğruluğa ulaşana kadar konum okumayı dener; ulaşamazsa en iyi
 * örneği döndürür. Hiç okuma yapılamazsa `LocationError` fırlatır.
 */
export async function acquireFix(options: AcquireFixOptions = {}): Promise<GeoFix> {
  const targetAccuracyM = options.targetAccuracyM ?? TARGET_GPS_ACCURACY_M;
  const attempts = options.attempts ?? 6;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    throw new LocationError('Konum servisleri kapalı. Lütfen GPS’i açın.');
  }

  // Hızlı başlangıç: son bilinen konum hedefe yeterince iyiyse onu kullan.
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 60_000,
    requiredAccuracy: targetAccuracyM,
  }).catch(() => null);

  let best: GeoFix | null = lastKnown ? toFix(lastKnown) : null;
  if (best && best.accuracyM <= targetAccuracyM) {
    return best;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const position = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        timeoutMs,
      );
      const fix = toFix(position);

      if (!best || fix.accuracyM < best.accuracyM) {
        best = fix;
      }

      if (fix.accuracyM <= targetAccuracyM) {
        return fix;
      }
    } catch {
      // Zaman aşımı veya geçici hata: bir sonraki denemeye geç.
    }

    if (attempt < attempts - 1) {
      await delay(1_200);
    }
  }

  if (best) {
    return best;
  }

  throw new LocationError('Konum alınamadı. Açık alanda tekrar deneyin.');
}

function toFix(position: Location.LocationObject): GeoFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyM: Math.max(0, position.coords.accuracy ?? 999),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LocationError('Konum isteği zaman aşımına uğradı'));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
