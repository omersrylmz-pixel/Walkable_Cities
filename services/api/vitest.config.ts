import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Compose tabanlı uçtan uca testler ayrı çalıştırılır (bkz. test:integration).
    exclude: ['node_modules/**', 'test/integration/**'],
    reporters: 'default',
  },
});
