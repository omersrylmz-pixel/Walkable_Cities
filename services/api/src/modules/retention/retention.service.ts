import type { StorageAdapter } from '../../storage/types.js';
import type { RetentionRepository } from './retention.repository.js';

export interface RetentionLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

export interface RetentionServiceDeps {
  repository: RetentionRepository;
  storage: StorageAdapter;
  batchSize?: number;
  maxBatches?: number;
  now?: () => Date;
  logger?: RetentionLogger;
}

export interface PurgeResult {
  /** Depolama ve DB kaydı silinen görsel sayısı. */
  deleted: number;
  /** Silinemeyen görsel sayısı (sonraki çalıştırmada yeniden denenir). */
  failed: number;
  /** Taranan toplam aday sayısı. */
  scanned: number;
  /** Kaç parti işlendi. */
  batches: number;
  /** Maksimum parti sınırına ulaşıldı mı? */
  limited: boolean;
}

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 50;

/**
 * KVKK saklama süresi temizliği.
 *
 * Süresi dolan görsellerin önce depolama nesnesi, ardından DB kaydı silinir.
 * Böylece DB kaydı silinip dosya diskte kalmaz (asıl KVKK riski). Depolama
 * silme başarısız olursa DB kaydı korunur ve bir sonraki çalıştırmada yeniden
 * denenir; `delete` işlemleri idempotenttir.
 */
export class RetentionService {
  private readonly batchSize: number;
  private readonly maxBatches: number;
  private readonly now: () => Date;
  private readonly logger?: RetentionLogger;

  constructor(private readonly deps: RetentionServiceDeps) {
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger;
  }

  async purgeExpiredImages(): Promise<PurgeResult> {
    const result: PurgeResult = { deleted: 0, failed: 0, scanned: 0, batches: 0, limited: false };

    for (let batch = 0; batch < this.maxBatches; batch += 1) {
      const candidates = await this.deps.repository.findExpiredImages(this.now(), this.batchSize);
      if (candidates.length === 0) {
        return result;
      }

      result.batches += 1;
      result.scanned += candidates.length;

      for (const candidate of candidates) {
        try {
          await this.deps.storage.delete(candidate.storagePath);
          const deleted = await this.deps.repository.deleteImage(candidate.id);

          if (deleted) {
            result.deleted += 1;
          } else {
            // Başka bir süreç aynı kaydı silmiş olabilir; dosya zaten yok.
            result.failed += 1;
          }
        } catch (error) {
          result.failed += 1;
          this.logger?.warn(
            { imageId: candidate.id, storagePath: candidate.storagePath, err: error },
            'Saklama süresi dolan görsel silinemedi; sonraki çalıştırmada denenecek',
          );
        }
      }

      this.logger?.info(
        { batch: result.batches, deleted: result.deleted, failed: result.failed },
        'Saklama temizliği partisi tamamlandı',
      );

      if (candidates.length < this.batchSize) {
        return result;
      }
    }

    result.limited = true;
    this.logger?.warn(
      { maxBatches: this.maxBatches },
      'Saklama temizliği parti sınırına ulaştı; kalan kayıtlar sonraki çalıştırmada silinecek',
    );

    return result;
  }
}
