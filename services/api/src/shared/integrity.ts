import exifr from 'exifr';

/** EXIF konumu ile istemci konumu arasında kabul edilen en fazla fark (metre). */
export const EXIF_GPS_TOLERANCE_M = 100;

/** EXIF zamanı ile istemci zamanı arasında kabul edilen en fazla fark (saniye). */
export const EXIF_TIME_TOLERANCE_SECONDS = 300;

export type IntegrityCheckStatus = 'match' | 'mismatch' | 'missing';

export interface IntegrityCheck {
  status: IntegrityCheckStatus;
  /** Ölçülen fark: GPS için metre, zaman için saniye. Yoksa `null`. */
  difference: number | null;
  tolerance: number;
}

export interface ExifSnapshot {
  present: boolean;
  /** EXIF'in yerel duvar saati (saat dilimi içermez), ISO benzeri biçimde. */
  capturedAt: string | null;
  gps: { latitude: number; longitude: number } | null;
  make: string | null;
  model: string | null;
  software: string | null;
}

export interface AnonymizationRecord {
  status: 'applied' | 'failed' | 'skipped';
  backend: string | null;
  facesBlurred: number;
  platesBlurred: number;
  error: string | null;
}

export interface ReportIntegrity {
  exif: ExifSnapshot;
  checks: {
    gps: IntegrityCheck;
    capturedAt: IntegrityCheck;
  };
  anonymization: AnonymizationRecord;
  checkedAt: string;
}

export interface ExifIntegrityInput {
  capturedAt: Date;
  /** İstemcinin `capturedAt` alanında bildirdiği UTC ofseti (dakika). */
  capturedAtOffsetMinutes: number;
  latitude: number;
  longitude: number;
}

export interface ExifIntegrityResult {
  exif: ExifSnapshot;
  checks: ReportIntegrity['checks'];
}

/**
 * Görseldeki EXIF verisini okur ve istemcinin bildirdiği konum/zamanla
 * karşılaştırır. GPS EXIF'te yoksa veya görsel EXIF taşımıyorsa ilgili kontrol
 * `missing` olur; bu bir hata değil, doğrulanamayan bir alan demektir.
 *
 * Zaman karşılaştırması EXIF'in saat dilimi taşımayan yerel duvar saati ile
 * istemcinin ISO-8601 ofseti üzerinden hesaplanan duvar saati arasında yapılır.
 */
export async function evaluateExifIntegrity(
  buffer: Buffer,
  input: ExifIntegrityInput,
): Promise<ExifIntegrityResult> {
  const exif = await readExifSnapshot(buffer);

  return {
    exif,
    checks: {
      gps: checkGps(exif.gps, input),
      capturedAt: checkCapturedAt(exif.capturedAt, input),
    },
  };
}

export async function readExifSnapshot(buffer: Buffer): Promise<ExifSnapshot> {
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = (await exifr.parse(buffer, {
      // Zamanı Date'e çevirme: saat dilimi belirsiz olduğu için ham metni
      // kendimiz yorumluyoruz.
      reviveValues: false,
      sanitize: true,
    })) as Record<string, unknown> | null;
  } catch {
    parsed = null;
  }

  if (!parsed || Object.keys(parsed).filter((key) => key !== 'errors').length === 0) {
    return {
      present: false,
      capturedAt: null,
      gps: null,
      make: null,
      model: null,
      software: null,
    };
  }

  return {
    present: true,
    capturedAt: parseExifTimestamp(parsed['DateTimeOriginal'] ?? parsed['CreateDate']),
    gps: readGps(parsed),
    make: asText(parsed['Make']),
    model: asText(parsed['Model']),
    software: asText(parsed['Software']),
  };
}

/** `YYYY:MM:DD HH:MM:SS` biçimindeki EXIF zamanını saat dilimsiz ISO'ya çevirir. */
export function parseExifTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value
    .trim()
    .match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function readGps(parsed: Record<string, unknown>): { latitude: number; longitude: number } | null {
  const latitude = asFiniteNumber(parsed['latitude']) ?? dmsToDecimal(parsed['GPSLatitude'], parsed['GPSLatitudeRef'], 'S');
  const longitude =
    asFiniteNumber(parsed['longitude']) ?? dmsToDecimal(parsed['GPSLongitude'], parsed['GPSLongitudeRef'], 'W');

  if (latitude === null || longitude === null) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}

function dmsToDecimal(value: unknown, ref: unknown, negativeRef: string): number | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const parts = value.map((part) => asFiniteNumber(part));
  if (parts.some((part) => part === null)) {
    return null;
  }

  const [degrees = 0, minutes = 0, seconds = 0] = parts as number[];
  const decimal = degrees + minutes / 60 + seconds / 3600;
  const refText = asText(ref)?.toUpperCase();

  return refText === negativeRef ? -decimal : decimal;
}

function checkGps(gps: { latitude: number; longitude: number } | null, input: ExifIntegrityInput): IntegrityCheck {
  if (!gps) {
    return { status: 'missing', difference: null, tolerance: EXIF_GPS_TOLERANCE_M };
  }

  const distance = haversineMeters(gps.latitude, gps.longitude, input.latitude, input.longitude);
  return {
    status: distance <= EXIF_GPS_TOLERANCE_M ? 'match' : 'mismatch',
    difference: Math.round(distance * 10) / 10,
    tolerance: EXIF_GPS_TOLERANCE_M,
  };
}

function checkCapturedAt(exifTimestamp: string | null, input: ExifIntegrityInput): IntegrityCheck {
  const exifWallClock = wallClockMs(exifTimestamp);
  if (exifWallClock === null) {
    return { status: 'missing', difference: null, tolerance: EXIF_TIME_TOLERANCE_SECONDS };
  }

  const deviceWallClock = clientWallClockMs(input.capturedAt, input.capturedAtOffsetMinutes);
  const difference = Math.round(Math.abs(exifWallClock - deviceWallClock) / 1000);

  return {
    status: difference <= EXIF_TIME_TOLERANCE_SECONDS ? 'match' : 'mismatch',
    difference,
    tolerance: EXIF_TIME_TOLERANCE_SECONDS,
  };
}

/** EXIF'in saat dilimsiz duvar saatini UTC tabanlı milisaniyeye çevirir. */
function wallClockMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(`${value}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * İstemcinin ISO-8601 zamanını bildirdiği ofsete göre duvar saatine çevirir.
 * Örnek: `2026-03-15T11:58:00+03:00` + 180 dk -> `2026-03-15T11:58:00Z`.
 */
function clientWallClockMs(capturedAt: Date, offsetMinutes: number): number {
  const shifted = new Date(capturedAt.getTime() + offsetMinutes * 60_000);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    shifted.getUTCHours(),
    shifted.getUTCMinutes(),
    shifted.getUTCSeconds(),
  );
}

/** ISO-8601 zamanının sonundaki UTC ofsetini dakika olarak döndürür (`Z` -> 0). */
export function parseCapturedAtOffsetMinutes(value: string): number {
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
  if (!match) {
    return 0;
  }

  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusM = 6_371_008.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
