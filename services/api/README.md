# API Servisi (Fastify + TypeScript)

Yaya alanı ihlal platformunun REST API katmanı. Faz 0 itibarıyla sağlık uçları ve yapılandırma doğrulaması hazırdır; iş mantığı fazlar halinde eklenecek.

## Sorumluluklar (yol haritası)

| Faz | Yetenek |
| --- | --- |
| 1 | `POST /v1/reports` (multipart), şema doğrulama, idempotency (`client_report_id`), sağlık uçları |
| 3 | KVKK anonimleştirme (yüz/plaka), EXIF GPS/zaman çapraz doğrulaması, SHA-256 mükerrer kontrolü |
| 3 | Manuel inceleme uçları (`GET /v1/review-queue`, `PATCH /v1/reports/:id/decision`, `GET /v1/reports/:id/audit`) |
| 5 | H3 agregasyon, sıcak nokta analizi tetikleme ve sonuç uçları |

## KVKK Görsel Hattı

`POST /v1/reports` akışı:

```text
multipart (report JSON + image)
  └─> tür/boyut/SHA-256 doğrulaması
      └─> EXIF oku -> GPS (±100 m) ve zaman (±300 sn) çapraz doğrulaması
          └─> AI: POST /v1/anonymize (yüz/plaka Gauss, EXIF'siz PNG)
              └─> depolama: original (erişimi kısıtlı) + anonymized
                  └─> tek transaction: reports (+integrity) ve report_images
```

- `ANONYMIZATION_REQUIRED=true` iken anonimleştirme başarısızsa istek
  `503 ANONYMIZATION_FAILED` ile reddedilir; anonimlenmemiş kayıt yazılmaz.
- EXIF sonuçları `reports.integrity` jsonb kolonunda saklanır:
  `exif`, `checks.gps`, `checks.capturedAt`, `anonymization`, `checkedAt`.
- EXIF zamanı saat dilimi taşımadığı için istemcinin `capturedAt` ofsetiyle
  hesaplanan duvar saati karşılaştırılır.
- `retention_expires_at`, `RETENTION_DAYS` (varsayılan 730 gün) sonrasına yazılır.
- Orijinal görsel yalnızca moderasyon/denetim için tutulur; yayınlanan görsel
  `kind='anonymized'` kaydıdır.

## Yapı

```text
src/
├── clients/
│   └── privacy-client.ts   # AI /v1/anonymize istemcisi
├── config/
│   └── env.ts              # zod ile ortam değişkeni doğrulama
├── modules/
│   ├── decisions/          # inceleme kuyruğu, manuel karar, audit
│   ├── health/
│   └── reports/            # ihbar CRUD, mükerrerlik, EXIF + KVKK akışı
├── shared/
│   ├── image.ts            # tür tespiti + SHA-256
│   └── integrity.ts        # EXIF okuma ve GPS/zaman karşılaştırması
├── app.ts                  # Fastify uygulaması (yan etkisiz fabrika)
└── server.ts               # giriş noktası (dinleme + graceful shutdown)
```

## Yerel Geliştirme

```bash
# kök dizinden
npm install
npm run api:dev
```

Sağlık kontrolü:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/health/ready
```

## Ortam Değişkenleri

`services/api/.env.example` dosyasını `services/api/.env` olarak kopyalayın. Kök `.env` ile aynı anahtarları kullanır.

## Komutlar

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | `tsx watch` ile sıcak yeniden yükleme |
| `npm run build` | TypeScript derlemesi (`dist/`) |
| `npm run start` | Derlenmiş sunucuyu çalıştırma |
| `npm run typecheck` | Tip kontrolü (çıktı üretmez) |
| `npm test` | Vitest birim/entegrasyon testleri |
| `npm run migrate:up` | Bekleyen SQL migrasyonlarını uygulama |
| `npm run retention:purge` | KVKK saklama süresi dolan görselleri silme (geliştirme) |
| `npm run retention:purge:prod` | Aynı işi derlenmiş kodla çalıştırma |

### Saklama süresi temizliği

`reports.retention_expires_at` süresi dolan görseller, önce depolama nesnesi
sonra DB kaydı silinerek temizlenir. Depolama silme başarısız olursa DB kaydı
korunur ve sonraki çalıştırmada yeniden denenir. Konteynerde günlük çalıştırma:

```bash
docker compose exec -T api node dist/scripts/purge-retention.js
```
