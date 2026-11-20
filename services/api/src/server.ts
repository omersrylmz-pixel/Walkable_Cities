import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

// Yerel geliştirmede iki konum denenir: servis dizini ve depo kökü.
// Docker'da değişkenler doğrudan ortamdan gelir; eksik dosyalar yok sayılır.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv();
loadDotenv({ path: path.resolve(moduleDir, '../../../.env') });

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp(env);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'Kapatma sinyali alındı, bağlantılar kapatılıyor');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Kapatma sırasında hata');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
  } catch (error) {
    app.log.error({ err: error }, 'Sunucu başlatılamadı');
    process.exit(1);
  }
}

void main();
