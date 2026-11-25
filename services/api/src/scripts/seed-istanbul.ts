/**
 * İstanbul için gerçekçi sentetik demo verisi üretir.
 *
 * Kullanım:
 *   npm run seed:istanbul                       # 750 kayıt
 *   npm run seed:istanbul -- --count 900        # kayıt sayısı
 *   npm run seed:istanbul -- --out ./.storage   # görsel çıktı dizini
 *
 * Ne yapar:
 *   1) Daha önce bu script'in yazdığı kayıtları siler (idempotent).
 *   2) Vatandaş kullanıcıları, ihbarları, AI değerlendirme kayıtlarını,
 *      denetim izlerini ve görsel meta verilerini veritabanına yazar.
 *   3) Sentetik PNG sahne görsellerini `STORAGE_LOCAL_DIR` altına yazar;
 *      konteyner ortamında dosyalar `docker cp` ile api volumesuna aktarılır.
 *
 * Not: `captured_at` tetikleyicisi (validate_report_temporal) kayıtların
 * en fazla 180 gün eski olmasını kabul eder; bu yüzden dağılım 170 güne
 * sıkıştırılır.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { config as loadDotenv } from 'dotenv';

import { loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv();
// Betik `src/scripts/` altında çalıştığı için hem servis hem depo kökü denenir.
loadDotenv({ path: path.resolve(moduleDir, '../../../.env') });
loadDotenv({ path: path.resolve(moduleDir, '../../../../.env') });

const SEED_MARKER = 'istanbul-demo';
const NAMESPACE = 'yaya-seed-istanbul';
const IMAGE_WIDTH = 480;
const IMAGE_HEIGHT = 360;
const SCENE_COUNT = 24;

// ---------------------------------------------------------------------------
// Deterministik RNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `noUncheckedIndexedAccess` altında indeks erişimini güvenli hale getirir. */
function pickFrom<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`Listede ${index}. eleman yok (uzunluk ${list.length})`);
  }
  return value;
}

/** FNV-1a tabanlı, tekrar çalıştırmada aynı kimliği üreten UUID. */
function uuidFromIndex(index: number): string {
  const input = `${NAMESPACE}:${index}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (c + i), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 + c * (i + 1), 0x27d4eb2f) >>> 0;
  }

  const hex = [h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// İlçe / mahalle verisi (merkez koordinatları yaklaşık; ağırlıklar nüfus ve
// yaya sıklığına göre ayarlanmış temsili değerlerdir)
// ---------------------------------------------------------------------------

interface District {
  name: string;
  lat: number;
  lng: number;
  weight: number;
  mahalle: string[];
}

const DISTRICTS: District[] = [
  { name: 'Kadıköy', lat: 40.99, lng: 29.03, weight: 7, mahalle: ['Caferağa', 'Rasimpaşa', 'Moda', 'Fenerbahçe', 'Kozyatağı', 'Bostancı', 'Göztepe'] },
  { name: 'Beşiktaş', lat: 41.04, lng: 29.01, weight: 6, mahalle: ['Bebek', 'Etiler', 'Levent', 'Ortaköy', 'Akatlar', 'Barbaros', 'Yıldız'] },
  { name: 'Şişli', lat: 41.06, lng: 28.99, weight: 6, mahalle: ['Nişantaşı', 'Teşvikiye', 'Bomonti', 'Esentepe', 'Kuştepe', 'Mecidiyeköy', 'Fulya'] },
  { name: 'Fatih', lat: 41.02, lng: 28.95, weight: 6, mahalle: ['Sultanahmet', 'Aksaray', 'Cerrahpaşa', 'Kocamustafapaşa', 'Yedikule', 'Zeyrek', 'Ayvansaray'] },
  { name: 'Beyoğlu', lat: 41.03, lng: 28.98, weight: 6, mahalle: ['İstiklal', 'Cihangir', 'Galata', 'Karaköy', 'Tophane', 'Kurtuluş', 'Halıcıoğlu'] },
  { name: 'Üsküdar', lat: 41.02, lng: 29.02, weight: 5, mahalle: ['Altunizade', 'Bulgurlu', 'Çengelköy', 'Kısıklı', 'Ünalan', 'Selimiye', 'İcadiye'] },
  { name: 'Maltepe', lat: 40.94, lng: 29.13, weight: 5, mahalle: ['Cevizli', 'Bağlarbaşı', 'Altıntepe', 'Küçükyalı', 'Zümrütevler', 'İdealtepe'] },
  { name: 'Pendik', lat: 40.87, lng: 29.26, weight: 5, mahalle: ['Kaynarca', 'Kurtköy', 'Velibaba', 'Çamçeşme', 'Güzelyalı', 'Şeyhli'] },
  { name: 'Ümraniye', lat: 41.03, lng: 29.15, weight: 5, mahalle: ['Çakmak', 'İnkılap', 'Şerifali', 'Atakent', 'Dudullu', 'Site Mahallesi'] },
  { name: 'Bağcılar', lat: 41.0, lng: 28.86, weight: 5, mahalle: ['Bağcılar Merkez', 'Güneşli', 'Yenidoğan', 'Yenimahalle', 'Çınar', 'Barbaros'] },
  { name: 'Esenyurt', lat: 40.99, lng: 28.67, weight: 5, mahalle: ['Akçaburgaz', 'Fatih', 'Yenişehir', 'Pınar', 'Mehterçeşme', 'Yunusbeyi'] },
  { name: 'Küçükçekmece', lat: 41.0, lng: 28.77, weight: 5, mahalle: ['Atakent', 'Halkalı', 'İkitelli', 'Tepeüstü', 'Gültepe', 'Cennet'] },
  { name: 'Kartal', lat: 40.91, lng: 29.19, weight: 4, mahalle: ['Yakacık', 'Soğanlık', 'Atalar', 'Esentepe', 'Kordonboyu', 'Uğur Mumcu'] },
  { name: 'Bakırköy', lat: 40.97, lng: 28.87, weight: 4, mahalle: ['Ataköy', 'Yeşilköy', 'Florya', 'Zuhuratbaba', 'Kartaltepe', 'İncirli'] },
  { name: 'Bahçelievler', lat: 40.98, lng: 28.83, weight: 4, mahalle: ['Bahçelievler', 'Şirinevler', 'Yenibosna', 'Cumhuriyet', 'Hürriyet'] },
  { name: 'Bayrampaşa', lat: 41.04, lng: 28.9, weight: 4, mahalle: ['Terazidere', 'Muratpaşa', 'Kocatepe', 'Yıldırım', 'Emniyet'] },
  { name: 'Esenler', lat: 41.0, lng: 28.87, weight: 4, mahalle: ['Atışalanı', 'Ortaçeşme', 'Mimar Sinan', 'Barbaros', 'Fevzipaşa'] },
  { name: 'Gaziosmanpaşa', lat: 41.07, lng: 28.91, weight: 4, mahalle: ['Bağlarbaşı', 'Karadeniz', 'Sarıgöl', 'Küçükköy', 'Merkez'] },
  { name: 'Sultangazi', lat: 41.1, lng: 28.87, weight: 4, mahalle: ['Cebeci', 'Uğur Mumcu', 'Zübeyde Hanım', 'Gazi', 'Sultançiftliği'] },
  { name: 'Zeytinburnu', lat: 41.0, lng: 28.9, weight: 4, mahalle: ['Kazlıçeşme', 'Sümer', 'Merkez', 'Tolunay', 'Çobançeşme'] },
  { name: 'Kağıthane', lat: 41.07, lng: 28.97, weight: 4, mahalle: ['Nurtepe', 'Şirintepe', 'Ortabayır', 'Gültepe', 'Talatpaşa'] },
  { name: 'Sarıyer', lat: 41.16, lng: 29.05, weight: 4, mahalle: ['Maslak', 'Tarabya', 'Yeniköy', 'Emirgan', 'Baltalimanı', 'Ayazağa'] },
  { name: 'Ataşehir', lat: 40.99, lng: 29.12, weight: 4, mahalle: ['Barbaros', 'İçerenköy', 'Merkez', 'Fetih', 'Örnek'] },
  { name: 'Sancaktepe', lat: 40.99, lng: 29.23, weight: 4, mahalle: ['Saray', 'Yenidoğan', 'Abdurrahmangazi', 'Samandıra', 'Osmangazi'] },
  { name: 'Güngören', lat: 41.01, lng: 28.87, weight: 3, mahalle: ['Güngören', 'Merter', 'Tozkoparan', 'Sanayi', 'Mehmet Nesih Öztürk'] },
  { name: 'Eyüpsultan', lat: 41.1, lng: 28.93, weight: 3, mahalle: ['Eyüp', 'Kemerburgaz', 'Defterdar', 'Alibeyköy', 'Akşemsettin', 'Rami'] },
  { name: 'Beykoz', lat: 41.16, lng: 29.09, weight: 3, mahalle: ['Kavacık', 'Paşabahçe', 'Anadolu Hisarı', 'Çubuklu', 'Acarkent', 'Kandilli'] },
  { name: 'Beylikdüzü', lat: 41.0, lng: 28.64, weight: 3, mahalle: ['Adnan Kahveci', 'Barbaros', 'Merkez', 'Gültepe', 'Yakuplu'] },
  { name: 'Büyükçekmece', lat: 41.02, lng: 28.6, weight: 3, mahalle: ['Kumburgağ', 'Tepecik', 'Pınarlı', 'Atatürk', 'Celaliye', 'Kamiloba'] },
  { name: 'Çekmeköy', lat: 41.14, lng: 29.14, weight: 3, mahalle: ['Alemdağ', 'Taşdelen', 'Soğukpınar', 'Mimar Sinan', 'Hamidiye'] },
  { name: 'Sultanbeyli', lat: 40.96, lng: 29.26, weight: 3, mahalle: ['Adil', 'Mehmet Akif', 'Battalgazi', 'Fatih', 'Necip Fazıl', 'Turgutreis'] },
  { name: 'Tuzla', lat: 40.82, lng: 29.3, weight: 3, mahalle: ['Aydınlı', 'İçmeler', 'Postane', 'Şifa', 'Mimar Sinan'] },
  { name: 'Avcılar', lat: 40.98, lng: 28.72, weight: 3, mahalle: ['Ambarlı', 'Cihangir', 'Firuzköy', 'Gümüşpala', 'Mustafa Kemal Paşa'] },
  { name: 'Başakşehir', lat: 41.1, lng: 28.8, weight: 3, mahalle: ['Bahçeşehir', 'Altınşehir', 'Kayabaşı', 'Ziya Gökalp', 'Necip Fazıl'] },
  { name: 'Şile', lat: 41.18, lng: 29.61, weight: 1, mahalle: ['Ağva', 'Merkez', 'Çavuş', 'Kumbaba', 'Sofular'] },
  { name: 'Adalar', lat: 40.87, lng: 29.09, weight: 1, mahalle: ['Büyükada', 'Heybeliada', 'Kınalıada', 'Burgazada'] },
  { name: 'Silivri', lat: 41.07, lng: 28.25, weight: 1, mahalle: ['Alibey', 'Cumhuriyet', 'Gümüşyaka', 'Mimar Sinan', 'Selimpaşa'] },
  { name: 'Çatalca', lat: 41.2, lng: 28.45, weight: 1, mahalle: ['Merkez', 'İnceğiz', 'Binkılıç', 'Karamandere', 'Subaşı'] },
  { name: 'Arnavutköy', lat: 41.21, lng: 28.73, weight: 2, mahalle: ['Hadımköy', 'Taşoluk', 'Ömerli', 'Bolluca', 'Yavuzselim'] },
];

const STREETS = [
  'Atatürk Caddesi',
  'Cumhuriyet Sokak',
  'İnönü Caddesi',
  'Gül Sokak',
  'Bağdat Caddesi',
  'İstiklal Caddesi',
  'Menderes Caddesi',
  'Lale Sokak',
  'Papatya Sokak',
  'Mimar Sinan Caddesi',
  'Çınar Sokak',
  'Sahil Yolu',
  'Fatih Caddesi',
  'Yeni Yol Sokak',
  'Güzeltepe Sokak',
];

type ViolationType =
  | 'kaldirim_isgali'
  | 'yaya_gecidi_ihlali'
  | 'sabit_engel'
  | 'yuzey_bozulmasi'
  | 'gecici_engel';

const VIOLATION_WEIGHTS: Array<{ type: ViolationType; weight: number; severity: [number, number] }> = [
  { type: 'kaldirim_isgali', weight: 38, severity: [3, 5] },
  { type: 'yaya_gecidi_ihlali', weight: 22, severity: [4, 5] },
  { type: 'yuzey_bozulmasi', weight: 17, severity: [2, 4] },
  { type: 'sabit_engel', weight: 13, severity: [2, 4] },
  { type: 'gecici_engel', weight: 10, severity: [1, 3] },
];

const DESCRIPTIONS: Record<ViolationType, string[]> = {
  kaldirim_isgali: [
    'Araç kaldırımın tamamını kapatmış, yayalar yol kenarından yürümek zorunda.',
    'İş yeri tezgâhı kaldırımı daraltmış, bebek arabası geçemiyor.',
    'Park eden araç yayaları caddeye taşıyor.',
    'Tabela ve sandıklar kaldırımın yarısını kaplamış durumda.',
    'Kamyonet kaldırıma yükleme yapıyor, yaya geçişi kapalı.',
  ],
  yaya_gecidi_ihlali: [
    'Yaya geçidinin üstünde araç park etmiş, geçit tamamen kapalı.',
    'Geçit çizgileri araç tarafından kapatılmış, güvenli geçiş yok.',
    'İnşaat malzemesi yaya geçidini kullanılamaz hale getirmiş.',
    'Servis aracı geçit üzerinde durmuş, öğrenciler karşıya geçemiyor.',
  ],
  sabit_engel: [
    'Trafo kabini kaldırımın ortasında, tekerlekli sandalye geçemiyor.',
    'Çöp konteynerleri yaya yolunu kapatmış durumda.',
    'Direk kaldırımın tam ortasına yerleştirilmiş.',
    'Bisiklet parkı yaya koridorunu daraltmış.',
  ],
  yuzey_bozulmasi: [
    'Kaldırım taşları sökülmüş, çukur derinleşmiş.',
    'Asfalt çökmüş, tekerlekli sandalye için tehlikeli.',
    'Kırık kaldırım parçaları yaya yolunu daraltmış.',
    'Bordür kayması nedeniyle yaya alanı düzensizleşmiş.',
  ],
  gecici_engel: [
    'İnşaat molozu kaldırım üzerinde bekliyor.',
    'Geçici tabela yaya yolunu kapatmış.',
    'Kaldırım çalışması için açılan çukur işaretlenmemiş.',
    'Etkinlik çitleri yaya akışını tamamen durdurmuş.',
  ],
};

const REASONS = [
  'engel maskesi yaya alanı ile %82 örtüşüyor',
  'kaldırım genişliği 1,2 m altına düşmüş',
  'yaya geçidi erişimi tamamen kapalı',
  'GPS EXIF ile %98 uyumlu',
  'açıklama metni tespiti destekliyor',
  'tekrar kayıt değil (benzerlik < 0.70)',
];

// ---------------------------------------------------------------------------
// Sentetik PNG sahneleri
// ---------------------------------------------------------------------------

interface Scene {
  width: number;
  height: number;
  rgb: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(scene: Scene): Buffer {
  const { width, height, rgb } = scene;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filtre: None
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 2; // renk tipi: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(scene: Scene, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return;
  const offset = (y * scene.width + x) * 3;
  scene.rgb[offset] = color[0];
  scene.rgb[offset + 1] = color[1];
  scene.rgb[offset + 2] = color[2];
}

function fillRect(
  scene: Scene,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: [number, number, number],
): void {
  for (let y = Math.max(0, y0); y < Math.min(scene.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(scene.width, x1); x += 1) {
      setPixel(scene, x, y, color);
    }
  }
}

/** Kaldırım/işgal sahnesini andıran basit, düzgün gradyanlı görüntü üretir. */
function renderScene(seed: number): Scene {
  const rng = mulberry32(seed);
  const scene: Scene = {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    rgb: Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 3),
  };

  const horizon = Math.floor(scene.height * 0.4);
  const sidewalkTop = Math.floor(scene.height * 0.62);
  const roadTop = Math.floor(scene.height * 0.72);

  // Gökyüzü
  for (let y = 0; y < horizon; y += 1) {
    const t = y / horizon;
    const color: [number, number, number] = [
      Math.round(120 + 70 * t),
      Math.round(170 + 60 * t),
      Math.round(220 + 30 * t),
    ];
    fillRect(scene, 0, y, scene.width, y + 1, color);
  }

  // Bantlar (bina siluetleri)
  let x = 0;
  while (x < scene.width) {
    const blockWidth = 40 + Math.floor(rng() * 70);
    const height = 40 + Math.floor(rng() * (horizon - 20));
    const shade = 70 + Math.floor(rng() * 60);
    fillRect(
      scene,
      x,
      horizon - height,
      Math.min(scene.width, x + blockWidth),
      horizon,
      [shade, shade + 6, shade + 12],
    );
    // pencereler
    for (let wx = x + 6; wx < x + blockWidth - 6; wx += 14) {
      for (let wy = horizon - height + 8; wy < horizon - 8; wy += 16) {
        if (rng() > 0.45) fillRect(scene, wx, wy, wx + 7, wy + 9, [230, 220, 160]);
      }
    }
    x += blockWidth;
  }

  // Kaldırım
  fillRect(scene, 0, horizon, scene.width, sidewalkTop, [176, 176, 172]);
  for (let gx = 0; gx < scene.width; gx += 34) {
    fillRect(scene, gx, horizon, gx + 1, sidewalkTop, [150, 150, 146]);
  }

  // Cadde
  fillRect(scene, 0, sidewalkTop, scene.width, scene.height, [96, 98, 102]);
  fillRect(scene, 0, roadTop - 4, scene.width, roadTop, [210, 210, 205]); // bordür

  // Şerit çizgileri
  for (let lx = 10; lx < scene.width; lx += 70) {
    fillRect(scene, lx, Math.floor(scene.height * 0.88), lx + 34, Math.floor(scene.height * 0.88) + 5, [235, 235, 230]);
  }

  // Araçlar (kaldırımı/işgali temsil eden dikdörtgenler)
  const carColors: Array<[number, number, number]> = [
    [196, 62, 62],
    [58, 92, 176],
    [232, 232, 232],
    [40, 42, 46],
    [238, 178, 60],
  ];
  const carCount = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < carCount; i += 1) {
    const carWidth = 56 + Math.floor(rng() * 40);
    const carX = Math.floor(rng() * (scene.width - carWidth));
    // Bazı araçlar kaldırıma taşar (ihbar senaryosu).
    const onSidewalk = rng() < 0.4;
    const carY = onSidewalk
      ? sidewalkTop - 34 + Math.floor(rng() * 14)
      : roadTop + Math.floor(rng() * 24);
    const color = carColors[Math.floor(rng() * carColors.length)] ?? [128, 128, 128];
    fillRect(scene, carX, carY, carX + carWidth, carY + 30, color);
    fillRect(scene, carX + 8, carY - 10, carX + carWidth - 8, carY + 2, [
      Math.max(0, (color[0] ?? 0) - 40),
      Math.max(0, (color[1] ?? 0) - 40),
      Math.max(0, (color[2] ?? 0) - 40),
    ]);
    fillRect(scene, carX + 6, carY + 26, carX + 16, carY + 32, [30, 30, 30]);
    fillRect(scene, carX + carWidth - 16, carY + 26, carX + carWidth - 6, carY + 32, [30, 30, 30]);
  }

  // Hafif gürültü (kamera hissi)
  for (let y = 0; y < scene.height; y += 2) {
    for (let px = 0; px < scene.width; px += 2) {
      if (rng() > 0.85) {
        const offset = (y * scene.width + px) * 3;
        const delta = Math.round((rng() - 0.5) * 14);
        scene.rgb[offset] = clamp((scene.rgb[offset] ?? 0) + delta);
        scene.rgb[offset + 1] = clamp((scene.rgb[offset + 1] ?? 0) + delta);
        scene.rgb[offset + 2] = clamp((scene.rgb[offset + 2] ?? 0) + delta);
      }
    }
  }

  return scene;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

/** Yüz/plaka bölgelerini bulanıklaştırmayı simüle eden varyant üretir. */
function renderAnonymized(scene: Scene, seed: number): Scene {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const output: Scene = { width: scene.width, height: scene.height, rgb: Buffer.from(scene.rgb) };

  const boxes = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < boxes; i += 1) {
    const boxWidth = 40 + Math.floor(rng() * 60);
    const boxHeight = 30 + Math.floor(rng() * 40);
    const x0 = Math.floor(rng() * (scene.width - boxWidth));
    const y0 = Math.floor(scene.height * 0.35 + rng() * (scene.height * 0.5));
    // Kutu içindeki piksellerin ortalaması: bulanık (yerel ortalama) etkisi.
    const [r, g, b] = averageColor(scene, x0, y0, boxWidth, boxHeight);
    fillRect(output, x0, y0, x0 + boxWidth, y0 + boxHeight, [r, g, b]);
    // Kenar bulanıklığı: 2 px dış halka
    fillRect(output, x0 - 2, y0 - 2, x0 + boxWidth + 2, y0, [r, g, b]);
    fillRect(output, x0 - 2, y0 + boxHeight, x0 + boxWidth + 2, y0 + boxHeight + 2, [r, g, b]);
    fillRect(output, x0 - 2, y0, x0, y0 + boxHeight, [r, g, b]);
    fillRect(output, x0 + boxWidth, y0, x0 + boxWidth + 2, y0 + boxHeight, [r, g, b]);
  }

  return output;
}

function averageColor(
  scene: Scene,
  x0: number,
  y0: number,
  width: number,
  height: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = Math.max(0, y0); y < Math.min(scene.height, y0 + height); y += 2) {
    for (let x = Math.max(0, x0); x < Math.min(scene.width, x0 + width); x += 2) {
      const offset = (y * scene.width + x) * 3;
      r += scene.rgb[offset] ?? 0;
      g += scene.rgb[offset + 1] ?? 0;
      b += scene.rgb[offset + 2] ?? 0;
      count += 1;
    }
  }

  if (count === 0) return [128, 128, 128];
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

// ---------------------------------------------------------------------------
// Kayıt üretimi
// ---------------------------------------------------------------------------

interface SeedReport {
  id: string;
  district: District;
  mahalle: string;
  street: string;
  violationType: ViolationType;
  severity: number;
  description: string;
  score: number | null;
  status: 'auto_approved' | 'pending_review' | 'auto_rejected' | 'approved' | 'rejected' | 'failed';
  decision: 'auto_accept' | 'manual_review' | 'auto_reject' | 'manual_accept' | 'manual_reject' | null;
  capturedAt: Date;
  receivedAt: Date;
  latitude: number;
  longitude: number;
  accuracyM: number;
  addressText: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  sceneIndex: number;
}

function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let target = rng() * total;
  for (const item of items) {
    target -= item.weight;
    if (target <= 0) return item;
  }
  return pickFrom(items, items.length - 1);
}

function pickViolation(rng: () => number): ViolationType {
  const total = VIOLATION_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
  let target = rng() * total;
  for (const item of VIOLATION_WEIGHTS) {
    target -= item.weight;
    if (target <= 0) return item.type;
  }
  return 'kaldirim_isgali';
}

/** Son 170 gün içinde, son 30 güne ağırlıklı zaman seçer. */
function pickCapturedAt(rng: () => number, now: Date): Date {
  const roll = rng();
  const daysAgo =
    roll < 0.55
      ? rng() * 30
      : roll < 0.85
        ? 30 + rng() * 60
        : 90 + rng() * 80;
  const minutes = Math.floor(rng() * 24 * 60);
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - minutes * 60 * 1000);
}

function buildReports(count: number, seed: number, now: Date): SeedReport[] {
  const rng = mulberry32(seed);
  const reports: SeedReport[] = [];

  const moderatorId = '22222222-2222-4222-8222-222222222222';
  const adminId = '11111111-1111-4111-8111-111111111111';

  // Her ilçe için 3 sıcak nokta: ısı haritasında anlamlı kümeler oluşur.
  const hotspots = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const district of DISTRICTS) {
    hotspots.set(
      district.name,
      Array.from({ length: 3 }, () => ({
        lat: district.lat + (rng() - 0.5) * 0.03,
        lng: district.lng + (rng() - 0.5) * 0.04,
      })),
    );
  }

  for (let index = 0; index < count; index += 1) {
    const district = pickWeighted(DISTRICTS, rng);
    const mahalle = pickFrom(district.mahalle, Math.floor(rng() * district.mahalle.length));
    const street = pickFrom(STREETS, Math.floor(rng() * STREETS.length));

    const spots = hotspots.get(district.name) ?? [];
    const spot = pickFrom(
      spots.length > 0 ? spots : [{ lat: district.lat, lng: district.lng }],
      Math.floor(rng() * Math.max(1, spots.length)),
    );
    const clustered = rng() < 0.6;
    const latitude = (clustered ? spot.lat : district.lat) + (rng() - 0.5) * 0.014;
    const longitude = (clustered ? spot.lng : district.lng) + (rng() - 0.5) * 0.018;

    const violationType = pickViolation(rng);
    const [sevMin, sevMax] =
      VIOLATION_WEIGHTS.find((item) => item.type === violationType)?.severity ?? [2, 4];
    const severity = sevMin + Math.floor(rng() * (sevMax - sevMin + 1));
    const descriptionPool = DESCRIPTIONS[violationType];
    const description = pickFrom(descriptionPool, Math.floor(rng() * descriptionPool.length));

    const capturedAt = pickCapturedAt(rng, now);
    const receivedAt = new Date(capturedAt.getTime() + (60_000 + Math.floor(rng() * 9 * 60_000)));

    const scoreRoll = rng();
    let score: number;
    if (scoreRoll < 0.45) {
      score = 0.85 + rng() * 0.14;
    } else if (scoreRoll < 0.78) {
      score = 0.6 + rng() * 0.249;
    } else {
      score = 0.2 + rng() * 0.39;
    }
    score = Math.min(0.995, Math.round(score * 1000) / 1000);

    let status: SeedReport['status'];
    let decision: SeedReport['decision'];
    let reviewedBy: string | null = null;
    let reviewNote: string | null = null;

    if (score >= 0.85) {
      status = 'auto_approved';
      decision = 'auto_accept';
    } else if (score >= 0.6) {
      // Kuyrukta kalanların bir kısmı moderatör tarafından sonuçlandırılmıştır.
      if (rng() < 0.55) {
        const accepted = rng() < 0.68;
        status = accepted ? 'approved' : 'rejected';
        decision = accepted ? 'manual_accept' : 'manual_reject';
        reviewedBy = rng() < 0.7 ? moderatorId : adminId;
        reviewNote = accepted
          ? 'Sahada doğrulandı; müdahale planına alındı.'
          : 'Görselde ihlal teyit edilemedi.';
      } else {
        status = 'pending_review';
        decision = 'manual_review';
      }
    } else {
      status = 'auto_rejected';
      decision = 'auto_reject';
    }

    reports.push({
      id: uuidFromIndex(index),
      district,
      mahalle,
      street,
      violationType,
      severity,
      description,
      score,
      status,
      decision,
      capturedAt,
      receivedAt,
      latitude,
      longitude,
      accuracyM: Math.round((4 + rng() * 26) * 100) / 100,
      addressText: `${district.name} · ${mahalle}, ${street}`,
      reviewedBy,
      reviewNote,
      sceneIndex: Math.floor(rng() * SCENE_COUNT),
    });
  }

  return reports;
}

// ---------------------------------------------------------------------------
// Veritabanı yazımı
// ---------------------------------------------------------------------------

const REPORT_INSERT = `
  INSERT INTO reports (
    id, client_report_id, reporter_id, violation_type, status, decision, confidence_score,
    severity, description, captured_at, received_at, location, gps_accuracy_m, gps_source,
    address_text, h3_resolution, anonymized_at, retention_expires_at, model_version,
    device_info, ai_metadata, integrity, reviewed_by, reviewed_at, review_note,
    created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4::violation_type, $5::report_status, $6::decision_outcome, $7,
    $8, $9, $10, $11, ST_SetSRID(ST_MakePoint($12, $13), 4326)::geometry, $14, 'device',
    $15, 9, $16, $17, $18,
    $19::jsonb, $20::jsonb, $21::jsonb, $22, $23, $24,
    $11, $11
  )
  RETURNING id
`;

const IMAGE_INSERT = `
  INSERT INTO report_images (
    report_id, kind, storage_path, mime_type, byte_size, width, height,
    sha256, blur_applied, faces_blurred, plates_blurred, exif_removed, created_at
  ) VALUES ($1, $2::media_kind, $3, 'image/png', $4, $5, $6, $7::bytea, $8, $9, $10, $11, $12)
`;

const EVALUATION_INSERT = `
  INSERT INTO report_evaluations (
    report_id, detector_name, detector_version, detector_confidence, overlap_ratio,
    walkable_area_ratio, detections, thresholds, outcome, latency_ms, created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::decision_outcome, $10, $11)
`;

const AUDIT_INSERT = `
  INSERT INTO report_audit_log (report_id, actor_id, action, from_status, to_status, payload, created_at)
  VALUES ($1, $2, $3, $4::report_status, $5::report_status, $6::jsonb, $7)
`;

interface CliOptions {
  count: number;
  outDir: string;
  seed: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { count: 750, outDir: '', seed: 20_260_101 };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--count' && value) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 5_000) options.count = parsed;
      i += 1;
    } else if (flag === '--out' && value) {
      options.outDir = value;
      i += 1;
    } else if (flag === '--seed' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) options.seed = parsed;
      i += 1;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  const pool = createPool(env);
  const outDir = path.resolve(options.outDir || env.STORAGE_LOCAL_DIR);
  const now = new Date();

  const reports = buildReports(options.count, options.seed, now);

  // Görseller: sınırlı sayıda benzersiz sahne üretilir, kayıtlara kopyalanır.
  console.log(`[seed] ${SCENE_COUNT} sahne üretiliyor…`);
  const originals: Buffer[] = [];
  const anonymized: Buffer[] = [];
  const sha256s: string[] = [];
  for (let i = 0; i < SCENE_COUNT; i += 1) {
    const scene = renderScene(options.seed + i * 977);
    const original = encodePng(scene);
    originals.push(original);
    anonymized.push(encodePng(renderAnonymized(scene, options.seed + i * 977)));
    sha256s.push(createHash('sha256').update(original).digest('hex'));
  }

  const client = await pool.connect();
  let inserted = 0;
  let imagesWritten = 0;

  try {
    await client.query('BEGIN');

    // 1) Önceki seed kayıtlarını temizle (idempotent tekrar çalıştırma).
    const deleted = await client.query(
      `DELETE FROM reports WHERE device_info->>'seed' = $1`,
      [SEED_MARKER],
    );
    await client.query(`DELETE FROM app_user WHERE email LIKE 'vatandas%.yaya.test'`);
    if ((deleted.rowCount ?? 0) > 0) {
      console.log(`[seed] önceki ${deleted.rowCount} kayıt silindi`);
    }

    // 2) Vatandaş kullanıcılar (rapor sahipleri).
    const citizenIds: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const id = uuidFromIndex(100_000 + i);
      citizenIds.push(id);
      await client.query(
        `INSERT INTO app_user (id, display_name, email, role, kvkk_consent_at, kvkk_consent_ver, is_active, created_at)
         VALUES ($1, $2, $3, 'citizen', $4, 'kvkk-v1.2', true, $4)
         ON CONFLICT (email) DO NOTHING`,
        [
          id,
          `Vatandaş ${String(i + 1).padStart(2, '0')}`,
          `vatandas${String(i + 1).padStart(2, '0')}@yaya.test`,
          new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000),
        ],
      );
    }

    // 3) İhbarlar + bağlı kayıtlar.
    for (const [index, report] of reports.entries()) {
      const reporterId = citizenIds[index % citizenIds.length];
      const anonymizedAt = new Date(report.receivedAt.getTime() + 5_000);
      const retentionExpiresAt = new Date(report.receivedAt.getTime() + 730 * 24 * 60 * 60 * 1000);
      const checkedAt = anonymizedAt.toISOString();

      const integrity = {
        exif: {
          present: true,
          capturedAt: report.capturedAt.toISOString(),
          gps: { latitude: report.latitude, longitude: report.longitude },
          make: 'Apple',
          model: 'iPhone 14',
          software: 'Yaya/1.3.0',
        },
        checks: {
          gps: { status: 'match', difference: Math.round(report.accuracyM * 10) / 10, tolerance: 100 },
          capturedAt: { status: 'match', difference: 12, tolerance: 300 },
        },
        anonymization: {
          status: 'applied',
          backend: 'heuristic-blur',
          facesBlurred: 1,
          platesBlurred: 1,
          error: null,
        },
        checkedAt,
      };

      const aiMetadata = {
        source: 'heuristic',
        backend: 'heuristic',
        seeded: true,
        reasonCount: 3 + (index % 3),
        reasons: REASONS.slice(0, 3 + (index % 3)),
        detections: [
          { label: 'vehicle', confidence: Math.round((report.score ?? 0.5) * 100) / 100 },
          { label: 'walkable_area', confidence: Math.round(((report.score ?? 0.5) * 0.9 + 0.05) * 100) / 100 },
        ],
      };

      const row = await client.query<{ id: string }>(REPORT_INSERT, [
        report.id,
        report.id, // client_report_id: deterministik → tekrar çalıştırma güvenli
        reporterId,
        report.violationType,
        report.status,
        report.decision,
        report.score,
        report.severity,
        report.description,
        report.capturedAt,
        report.receivedAt,
        report.longitude,
        report.latitude,
        report.accuracyM,
        report.addressText,
        anonymizedAt,
        retentionExpiresAt,
        'heuristic-baseline-v1',
        JSON.stringify({
          seed: SEED_MARKER,
          platform: index % 3 === 0 ? 'ios' : 'android',
          appVersion: '1.3.0',
          locale: 'tr-TR',
        }),
        JSON.stringify(aiMetadata),
        JSON.stringify(integrity),
        report.reviewedBy,
        report.reviewedBy ? report.receivedAt : null,
        report.reviewNote,
      ]);

      const reportId = row.rows[0]?.id ?? report.id;
      const [year, month, day] = report.receivedAt.toISOString().slice(0, 10).split('-');
      const dirPart = `reports/${year ?? '1970'}/${month ?? '01'}/${day ?? '01'}`;
      const originalKey = `${dirPart}/${report.id}.png`;
      const anonymizedKey = `${dirPart}/${report.id}.anon.png`;

      const originalBytes = pickFrom(originals, report.sceneIndex);
      const anonymizedBytes = pickFrom(anonymized, report.sceneIndex);
      const originalPath = path.join(outDir, originalKey);
      const anonymizedPath = path.join(outDir, anonymizedKey);
      await mkdir(path.dirname(originalPath), { recursive: true });
      await mkdir(path.dirname(anonymizedPath), { recursive: true });
      await writeFile(originalPath, originalBytes);
      await writeFile(anonymizedPath, anonymizedBytes);
      imagesWritten += 2;

      const sha = Buffer.from(pickFrom(sha256s, report.sceneIndex), 'hex');
      await client.query(IMAGE_INSERT, [
        reportId,
        'original',
        originalKey,
        originalBytes.length,
        IMAGE_WIDTH,
        IMAGE_HEIGHT,
        sha,
        false,
        0,
        0,
        false,
        report.receivedAt,
      ]);
      await client.query(IMAGE_INSERT, [
        reportId,
        'anonymized',
        anonymizedKey,
        anonymizedBytes.length,
        IMAGE_WIDTH,
        IMAGE_HEIGHT,
        sha,
        true,
        1,
        1,
        true,
        anonymizedAt,
      ]);

      await client.query(EVALUATION_INSERT, [
        reportId,
        'heuristic-baseline',
        'heuristic-baseline-v1',
        report.score,
        report.score === null ? null : Math.min(0.99, report.score + 0.02),
        Math.round((0.35 + (report.score ?? 0.4) * 0.5) * 1000) / 1000,
        JSON.stringify(aiMetadata.detections),
        JSON.stringify({ auto_accept: 0.85, manual_review: 0.6 }),
        report.decision ?? 'manual_review',
        4 + ((index * 7) % 30),
        report.receivedAt,
      ]);

      await client.query(AUDIT_INSERT, [
        reportId,
        null,
        'report.created',
        null,
        'queued',
        JSON.stringify({ source: 'mobile', seed: SEED_MARKER }),
        report.receivedAt,
      ]);

      if (report.reviewedBy) {
        await client.query(AUDIT_INSERT, [
          reportId,
          report.reviewedBy,
          'report.decision.manual',
          'pending_review',
          report.status,
          JSON.stringify({ note: report.reviewNote, score: report.score }),
          new Date(report.receivedAt.getTime() + 30 * 60_000),
        ]);
      } else {
        await client.query(AUDIT_INSERT, [
          reportId,
          null,
          'report.decision.auto',
          'queued',
          report.status,
          JSON.stringify({ score: report.score, source: 'heuristic' }),
          new Date(report.receivedAt.getTime() + 3_000),
        ]);
      }

      inserted += 1;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const byStatus = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.status] = (acc[report.status] ?? 0) + 1;
    return acc;
  }, {});
  const byType = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.violationType] = (acc[report.violationType] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`[seed] ${inserted} ihbar, ${imagesWritten} görsel yazıldı`);
  console.log(`[seed] çıktı dizini: ${outDir}`);
  console.log(`[seed] durum dağılımı: ${JSON.stringify(byStatus)}`);
  console.log(`[seed] tür dağılımı: ${JSON.stringify(byType)}`);
  console.log('[seed] görselleri api konteynerine aktarmak için:');
  console.log('  docker cp <outDir>/. yaya-api:/app/.storage/');
}

main().catch((error: unknown) => {
  console.error('[seed] başarısız:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
