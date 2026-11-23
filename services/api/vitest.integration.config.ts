import { defineConfig } from 'vitest/config';

/**
 * Compose tabanlı uçtan uca entegrasyon testleri.
 *
 * Çalışan yığına (API :3001, AI :8001, PostgreSQL) gerçek HTTP ve SQL
 * çağrıları yapar; bu yüzden normal `npm test` hızlı birim testlerinden
 * ayrılmıştır. Kullanım:
 *
 *   npm run stack:up
 *   npm run test:integration
 *
 * Dosyalar sıralı çalışır: AI'ı durduran ve saklama temizliği yapan
 * senaryolar birbirini etkilememelidir.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    exclude: ['node_modules/**'],
    reporters: 'default',
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
  },
});
