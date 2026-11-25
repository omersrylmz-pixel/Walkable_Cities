import { z } from 'zod';

/**
 * Boş string ile tanımsız değeri ayırt eder.
 * `.env` dosyasında `SUPABASE_URL=` gibi boş bırakılan alanlar hata üretmemeli.
 */
const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

/** `false`, `0`, `no`, `off` değerlerini false; diğer dolu değerleri true kabul eder. */
const booleanFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      return fallback;
    }
    return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  CORS_ORIGINS: z.string().default('http://localhost:3002,http://localhost:8081'),

  DATABASE_URL: optionalString,
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8001'),

  /** KVKK: yüz/plaka anonimleştirme açık mı? Kapalıysa yalnızca orijinal saklanır. */
  ANONYMIZATION_ENABLED: booleanFromEnv(true),
  /**
   * Anonimleştirme başarısız olduğunda ihbar reddedilsin mi?
   * KVKK için üretimde `true` önerilir; geliştirmede AI servisi kapalıyken
   * `false` yaparak akış test edilebilir.
   */
  ANONYMIZATION_REQUIRED: booleanFromEnv(true),
  ANONYMIZATION_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),

  /**
   * Yeni ihbarlar AI analiz servisine gitsin mi? Kapalıysa skor doğrudan
   * kural tabanlı (heuristic) hattan üretilir.
   */
  AI_ANALYSIS_ENABLED: booleanFromEnv(true),
  /**
   * AI analizi başarısızsa ihbar reddedilsin mi?
   * `false` iken kural tabanlı skorla devam edilir; kayıt kaybolmaz.
   */
  AI_ANALYSIS_REQUIRED: booleanFromEnv(false),
  AI_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),

  /** KVKK saklama süresi (gün); `retention_expires_at` bu süre sonrasına yazılır. */
  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(730),
  /** Temizlik işinin tek seferde işleyeceği görsel sayısı. */
  RETENTION_PURGE_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),
  /** Temizlik işinin tek çalıştırmada işleyeceği en fazla parti sayısı. */
  RETENTION_PURGE_MAX_BATCHES: z.coerce.number().int().min(1).max(1000).default(50),

  STORAGE_DRIVER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./.storage'),
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('reports'),

  /** Tek görsel için üst sınır (MB). */
  MAX_UPLOAD_MB: z.coerce.number().int().positive().max(50).default(12),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Ortam değişkenlerini doğrular; eksik/hatalı değerde süreci başlatmaz. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Ortam değişkenleri geçersiz -> ${details}`);
  }

  return parsed.data;
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
