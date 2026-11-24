// MapLibre web worker'ını Next.js'in servis edebileceği public/ klasörüne kopyalar.
// Next.js production build'i worker URL'sini kendi chunk'larına göre çözemediği
// için worker açıkça `/maplibre-gl-worker.mjs` adresinden yüklenir.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const workerSource = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist', 'maplibre-gl-worker.mjs');
const targetDir = join(process.cwd(), 'public');
const workerTarget = join(targetDir, 'maplibre-gl-worker.mjs');

await mkdir(targetDir, { recursive: true });
await copyFile(workerSource, workerTarget);
console.log(`[maplibre] worker kopyalandı: ${workerTarget}`);
