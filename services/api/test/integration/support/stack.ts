/**
 * Compose tabanlı entegrasyon testleri için yardımcılar.
 *
 * Testler çalışan `docker compose` yığınına (API :3001, AI :8001, Postgres)
 * karşı gerçek HTTP çağrıları yapar. DB doğrulamaları için yayınlanan
 * PostgreSQL portuna `pg` ile bağlanır; yıkıcı senaryolar (AI'ı durdurma,
 * saklama temizliği) `docker compose` komutlarıyla yürütülür.
 *
 * Varsayılanlar kök `.env` dosyasından okunur; farklı bir ortam için
 * `INTEGRATION_API_URL`, `INTEGRATION_AI_URL`, `INTEGRATION_DATABASE_URL`
 * değişkenleri kullanılabilir.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { Pool, type PoolConfig } from 'pg';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** `services/api/test/integration/support` -> depo kökü. */
export const REPO_ROOT = path.resolve(currentDir, '../../../../..');

loadDotenv({ path: path.join(REPO_ROOT, '.env'), override: false });

const apiPort = process.env.API_PORT ?? '3001';
const aiPort = process.env.AI_PORT ?? '8001';

export const API_BASE_URL = (process.env.INTEGRATION_API_URL ?? `http://localhost:${apiPort}`).replace(/\/$/, '');
export const AI_BASE_URL = (process.env.INTEGRATION_AI_URL ?? `http://localhost:${aiPort}`).replace(/\/$/, '');

const EXIF_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'services/api/test/fixtures/exif-sample.jpg',
);
/** Fixture içindeki `DateTimeOriginal` metni (19 bayt). */
const EXIF_FIXTURE_TIMESTAMP = Buffer.from('2026:03:15 11:58:00');
/** Fixture içindeki `Software` metni (18 bayt); her yüklemede tekilleştirilir. */
const EXIF_FIXTURE_SOFTWARE = Buffer.from('WalkableCitiesTest');

export interface DockerResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** `docker compose ...` komutunu depo kökünde çalıştırır. */
export function dockerCompose(
  args: string[],
  options: { allowFailure?: boolean } = {},
): DockerResult {
  const result = spawnSync('docker', ['compose', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  const status = result.status ?? 1;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (status !== 0 && !options.allowFailure) {
    throw new Error(
      `docker compose ${args.join(' ')} başarısız (çıkış ${status}):\n${stderr || stdout}`,
    );
  }

  return { status, stdout, stderr };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** URL 2xx dönene kadar bekler; süre dolunca açıklayıcı hata fırlatır. */
export async function waitForHttpOk(url: string, timeoutMs = 30_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'yanıt alınamadı';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        return response;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(1_000);
  }

  throw new Error(`${url} ${timeoutMs} ms içinde hazır olmadı (${lastError})`);
}

/** API ve AI servislerinin hazır olduğunu doğrular. */
export async function ensureStackReady(): Promise<void> {
  try {
    await waitForHttpOk(`${API_BASE_URL}/health/ready`, 5_000);
  } catch (error) {
    throw new Error(
      `API hazır değil (${API_BASE_URL}). Önce "npm run stack:up" ile yığını ayağa kaldırın.\n` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    await waitForHttpOk(`${AI_BASE_URL}/health/ready`, 10_000);
  } catch (error) {
    throw new Error(
      `AI servisi hazır değil (${AI_BASE_URL}). AI konteynerini ve model/heuristic hattını kontrol edin.\n` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// -----------------------------------------------------------------------------
// PostgreSQL erişimi
// -----------------------------------------------------------------------------

function discoverPostgresPort(): number {
  const explicit = process.env.INTEGRATION_POSTGRES_PORT;
  if (explicit && Number.isInteger(Number(explicit))) {
    return Number(explicit);
  }

  try {
    const { stdout } = dockerCompose(['port', 'postgres', '5432']);
    const line = stdout.trim().split(/\r?\n/)[0] ?? '';
    const port = Number(line.slice(line.lastIndexOf(':') + 1));
    if (Number.isInteger(port) && port > 0) {
      return port;
    }
  } catch {
    // Docker CLI yoksa veya servis kapalıysa .env değerine düş.
  }

  return Number(process.env.POSTGRES_PORT ?? 5432);
}

let pool: Pool | null = null;

/** Testler için paylaşılan `pg` havuzu. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.INTEGRATION_DATABASE_URL;
    const config: PoolConfig = connectionString
      ? { connectionString, max: 4, connectionTimeoutMillis: 5_000 }
      : {
          host: process.env.POSTGRES_HOST ?? '127.0.0.1',
          port: discoverPostgresPort(),
          user: process.env.POSTGRES_USER ?? 'yaya',
          password: process.env.POSTGRES_PASSWORD ?? 'yaya_dev_password',
          database: process.env.POSTGRES_DB ?? 'yaya',
          max: 4,
          connectionTimeoutMillis: 5_000,
        };

    pool = new Pool(config);
    pool.on('error', () => undefined);
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }
  const closing = pool;
  pool = null;
  await closing.end().catch(() => undefined);
}

// -----------------------------------------------------------------------------
// EXIF'li test görseli
// -----------------------------------------------------------------------------

export interface ExifImage {
  buffer: Buffer;
  /** EXIF duvar saati (`YYYY:MM:DD HH:mm:ss`). */
  exifWallClock: string;
  /** İstemcinin göndereceği ISO-8601 zaman (İstanbul, +03:00). */
  capturedAt: string;
  /** EXIF ile eşleşen sabit GPS noktası. */
  location: { latitude: number; longitude: number };
}

function istanbulParts(date: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );

  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;
}

function replaceAll(source: Buffer, search: Buffer, replacement: Buffer): Buffer {
  if (search.length !== replacement.length) {
    throw new Error('Yer değiştirme aynı uzunlukta olmalı (EXIF ofsetleri korunmalı)');
  }

  const result = Buffer.from(source);
  let index = result.indexOf(search);

  while (index !== -1) {
    replacement.copy(result, index);
    index = result.indexOf(search, index + replacement.length);
  }

  return result;
}

/**
 * Fixture JPEG'in EXIF zaman damgasını verilen ana, `Software` alanını da
 * tekil bir değere çevirir. Böylece her test yüklemesi farklı SHA-256 üretir
 * ve EXIF zamanı istemci zamanıyla eşleşir.
 */
export function buildExifImage(options: { now?: Date; unique?: boolean } = {}): ExifImage {
  const now = options.now ?? new Date();
  const parts = istanbulParts(now);
  const exifWallClock = `${parts.year}:${parts.month}:${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  const capturedAt = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+03:00`;
  // `WalkableCitiesTest` 18 bayt; aynı uzunlukta tekil değer üret.
  const software = `WCT-${randomUUID().replace(/-/g, '').slice(0, 14)}`;

  let buffer = readFileSync(EXIF_FIXTURE_PATH);
  const patched = replaceAll(
    buffer,
    EXIF_FIXTURE_TIMESTAMP,
    Buffer.from(exifWallClock, 'ascii'),
  );

  buffer = options.unique === false
    ? patched
    : replaceAll(patched, EXIF_FIXTURE_SOFTWARE, Buffer.from(software, 'ascii'));

  return {
    buffer,
    exifWallClock,
    capturedAt,
    // Fixture GPS: 41.0082 N, 28.9784 E (İstanbul).
    location: { latitude: 41.0082, longitude: 28.9784 },
  };
}

export interface ReportMetadata {
  clientReportId: string;
  violationType: string;
  capturedAt: string;
  location: {
    latitude: number;
    longitude: number;
    accuracyM?: number;
    source?: string;
  };
  device?: Record<string, unknown>;
  description?: string;
  [key: string]: unknown;
}

export function makeMetadata(
  capturedAt: string,
  overrides: Partial<ReportMetadata> = {},
): ReportMetadata {
  const base: ReportMetadata = {
    clientReportId: randomUUID(),
    violationType: 'kaldirim_isgali',
    capturedAt,
    location: { latitude: 41.0082, longitude: 28.9784, accuracyM: 8.5, source: 'device' },
    device: { platform: 'android', appVersion: '1.0.0' },
    description: 'Entegrasyon testi',
  };

  return {
    ...base,
    ...overrides,
    location: { ...base.location, ...(overrides.location ?? {}) },
    device: { ...base.device, ...(overrides.device ?? {}) },
  };
}

// -----------------------------------------------------------------------------
// HTTP yardımcıları
// -----------------------------------------------------------------------------

export interface JsonResponse {
  status: number;
  headers: Headers;
  body: any;
  text: string;
}

export interface BinaryResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

async function parseJsonResponse(response: Response): Promise<JsonResponse> {
  const text = await response.text();
  let body: unknown = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  return { status: response.status, headers: response.headers, body, text };
}

/** `POST /v1/reports` — multipart (report JSON + image). */
export async function uploadReport(input: {
  image: Buffer;
  metadata: ReportMetadata;
  filename?: string;
  mimeType?: string;
}): Promise<JsonResponse> {
  const form = new FormData();
  form.append('report', JSON.stringify(input.metadata));
  form.append(
    'image',
    new Blob([new Uint8Array(input.image)], { type: input.mimeType ?? 'image/jpeg' }),
    input.filename ?? 'report.jpg',
  );

  const response = await fetch(`${API_BASE_URL}/v1/reports`, { method: 'POST', body: form });
  return parseJsonResponse(response);
}

export async function getJson(pathname: string): Promise<JsonResponse> {
  const response = await fetch(`${API_BASE_URL}${pathname}`);
  return parseJsonResponse(response);
}

export async function sendJson(
  method: string,
  pathname: string,
  payload: unknown,
): Promise<JsonResponse> {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export async function getBinary(pathname: string): Promise<BinaryResponse> {
  const response = await fetch(`${API_BASE_URL}${pathname}`);
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

// -----------------------------------------------------------------------------
// Veritabanı senaryo yardımcıları
// -----------------------------------------------------------------------------

/** Skor yazınca DB tetikleyicisi durumu `pending_review` yapar. */
export async function promoteToPendingReview(
  reportId: string,
  score = 0.72,
): Promise<{ status: string; decision: string | null }> {
  const { rows } = await getPool().query<{ status: string; decision: string | null }>(
    `UPDATE reports SET confidence_score = $2 WHERE id = $1 RETURNING status, decision`,
    [reportId, score],
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`İhbar bulunamadı: ${reportId}`);
  }
  return row;
}

export async function expireRetention(reportId: string): Promise<void> {
  await getPool().query(
    `UPDATE reports SET retention_expires_at = now() - interval '1 day' WHERE id = $1`,
    [reportId],
  );
}

export async function countReportImages(reportId: string): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `SELECT count(*)::text AS total FROM report_images WHERE report_id = $1`,
    [reportId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function countReportsByClientId(clientReportId: string): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `SELECT count(*)::text AS total FROM reports WHERE client_report_id = $1`,
    [clientReportId],
  );
  return Number(rows[0]?.total ?? 0);
}

export async function createModerator(id: string = randomUUID()): Promise<string> {
  await getPool().query(
    `INSERT INTO app_user (id, display_name, role)
     VALUES ($1, $2, 'moderator')
     ON CONFLICT (id) DO NOTHING`,
    [id, 'Entegrasyon Test Moderatörü'],
  );
  return id;
}

export async function deleteUser(id: string): Promise<void> {
  await getPool().query(`DELETE FROM app_user WHERE id = $1`, [id]).catch(() => undefined);
}

// -----------------------------------------------------------------------------
// Docker ile yıkıcı/konteyner içi senaryolar
// -----------------------------------------------------------------------------

export function stopAiService(): void {
  dockerCompose(['stop', 'ai-service']);
}

export async function startAiServiceAndWait(timeoutMs = 180_000): Promise<void> {
  dockerCompose(['start', 'ai-service']);
  await waitForHttpOk(`${AI_BASE_URL}/health/ready`, timeoutMs);
  await waitForHttpOk(`${API_BASE_URL}/health/ready`, 30_000);
}

export interface PurgeResult {
  deleted?: number;
  failed?: number;
  scanned?: number;
  [key: string]: unknown;
}

/** API konteynerinde saklama temizliği betiğini çalıştırır ve JSON sonucu döndürür. */
export function runRetentionPurge(): PurgeResult {
  const { stdout } = dockerCompose([
    'exec',
    '-T',
    'api',
    'node',
    'dist/scripts/purge-retention.js',
  ]);

  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as PurgeResult & { message?: string };
      if (parsed.message === 'Saklama temizliği bitti') {
        return parsed;
      }
    } catch {
      // JSON olmayan günlük satırlarını yok say.
    }
  }

  throw new Error(`Saklama temizliği çıktısı ayrıştırılamadı:\n${stdout}`);
}

/** API konteynerinin depolama biriminde dosyanın var olup olmadığını döndürür. */
export function storageFileExists(storagePath: string): boolean {
  const { status } = dockerCompose(
    ['exec', '-T', 'api', 'test', '-f', `/app/.storage/${storagePath}`],
    { allowFailure: true },
  );
  return status === 0;
}

/** Test kaydını ve depolama nesnelerini temizler (idempotent). */
export async function cleanupReport(
  reportId: string | null | undefined,
  storagePaths: string[] = [],
): Promise<void> {
  for (const storagePath of storagePaths) {
    dockerCompose(['exec', '-T', 'api', 'rm', '-f', `/app/.storage/${storagePath}`], {
      allowFailure: true,
    });
  }

  if (reportId) {
    await getPool().query(`DELETE FROM reports WHERE id = $1`, [reportId]).catch(() => undefined);
  }
}
