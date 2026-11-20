import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { notFound } from '../shared/errors.js';
import type { PutObjectInput, StorageAdapter, StoredObject, StoredObjectData } from './types.js';

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Yerel dosya sistemi depolama adaptörü (geliştirme / tek düğüm kurulum).
 * Anahtarlar `reports/YYYY/MM/DD/<uuid>.jpg` biçimindedir; dizin dışına
 * çıkmayı engellemek için anahtar deseni doğrulanır.
 */
export class LocalStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const target = this.resolveSafePath(input.key);
    await mkdir(path.dirname(target), { recursive: true });

    // Önce geçici dosyaya yaz, sonra atomik olarak taşı.
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, input.body);
    await rename(temp, target);

    return {
      key: input.key,
      byteSize: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<StoredObjectData> {
    const target = this.resolveSafePath(key);
    try {
      const body = await readFile(target);
      return { body, contentType: contentTypeFor(key) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw notFound('Görsel bulunamadı');
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolveSafePath(key);
    await rm(target, { force: true });
  }

  private resolveSafePath(key: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.includes('..')) {
      throw new Error(`Geçersiz depolama anahtarı: ${key}`);
    }

    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`) && resolved !== this.root) {
      throw new Error(`Depolama dizini dışına çıkılamaz: ${key}`);
    }
    return resolved;
  }
}

function contentTypeFor(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}
