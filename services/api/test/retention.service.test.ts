import { describe, expect, it, vi } from 'vitest';

import type { RetentionRepository } from '../src/modules/retention/retention.repository.js';
import { RetentionService } from '../src/modules/retention/retention.service.js';
import type { StorageAdapter } from '../src/storage/types.js';

const NOW = new Date('2030-01-01T03:15:00.000Z');

function makeRepo(count: number) {
  const remaining = new Map(
    Array.from({ length: count }, (_, index) => [
      `img-${index + 1}`,
      `reports/2030/01/01/img-${index + 1}.jpg`,
    ]),
  );

  const repository = {
    findExpiredImages: vi.fn(async (_now: Date, limit: number) =>
      [...remaining.entries()].slice(0, limit).map(([id, storagePath]) => ({ id, storagePath })),
    ),
    deleteImage: vi.fn(async (id: string) => remaining.delete(id)),
  } as unknown as RetentionRepository;

  return { repository, remaining };
}

function makeStorage(failFor: string[] = []) {
  return {
    driver: 'local' as const,
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(async (key: string) => {
      if (failFor.some((fragment) => key.includes(fragment))) {
        throw new Error('storage down');
      }
    }),
  } as unknown as StorageAdapter;
}

describe('RetentionService', () => {
  it('süresi dolan görselleri partiler halinde siler', async () => {
    const { repository, remaining } = makeRepo(3);
    const storage = makeStorage();
    const service = new RetentionService({
      repository,
      storage,
      batchSize: 2,
      now: () => NOW,
    });

    const result = await service.purgeExpiredImages();

    expect(result).toMatchObject({ deleted: 3, failed: 0, scanned: 3, batches: 2, limited: false });
    expect(remaining.size).toBe(0);
    expect(storage.delete).toHaveBeenCalledTimes(3);
    expect(repository.findExpiredImages).toHaveBeenNthCalledWith(1, NOW, 2);
  });

  it('depolama silme başarısızsa DB kaydını korur ve diğerlerine devam eder', async () => {
    const { repository, remaining } = makeRepo(2);
    const storage = makeStorage(['img-1']);
    const service = new RetentionService({
      repository,
      storage,
      batchSize: 10,
      now: () => NOW,
    });

    const result = await service.purgeExpiredImages();

    expect(result).toMatchObject({ deleted: 1, failed: 1, scanned: 2, batches: 1, limited: false });
    expect(remaining.has('img-1')).toBe(true);
    expect(remaining.has('img-2')).toBe(false);
    expect(repository.deleteImage).toHaveBeenCalledTimes(1);
  });

  it('parti sınırına ulaşınca durur ve kalanları sonraki çalıştırmaya bırakır', async () => {
    const { repository, remaining } = makeRepo(4);
    const service = new RetentionService({
      repository,
      storage: makeStorage(),
      batchSize: 2,
      maxBatches: 1,
      now: () => NOW,
    });

    const result = await service.purgeExpiredImages();

    expect(result).toMatchObject({ deleted: 2, failed: 0, scanned: 2, batches: 1, limited: true });
    expect(remaining.size).toBe(2);
  });

  it('aday yoksa hiçbir silme çağrısı yapmaz', async () => {
    const { repository } = makeRepo(0);
    const storage = makeStorage();
    const service = new RetentionService({ repository, storage, now: () => NOW });

    const result = await service.purgeExpiredImages();

    expect(result).toEqual({ deleted: 0, failed: 0, scanned: 0, batches: 0, limited: false });
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
