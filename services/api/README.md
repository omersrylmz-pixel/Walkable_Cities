# API Servisi (Fastify + TypeScript)

Yaya alanı ihlal platformunun REST API katmanı. Faz 0 itibarıyla sağlık uçları ve yapılandırma doğrulaması hazırdır; iş mantığı fazlar halinde eklenecek.

## Sorumluluklar (yol haritası)

| Faz | Yetenek |
| --- | --- |
| 1 | `POST /v1/reports` (multipart), şema doğrulama, idempotency (`client_report_id`), sağlık uçları |
| 3 | KVKK anonimleştirme (yüz/plaka), SHA-256 mükerrer kontrolü, karar hattı |
| 3 | Manuel inceleme uçları (`GET /v1/review-queue`, `PATCH /v1/reports/:id/decision`) |
| 5 | H3 agregasyon, sıcak nokta analizi tetikleme ve sonuç uçları |

## Yapı

```text
src/
├── config/
│   └── env.ts              # zod ile ortam değişkeni doğrulama
├── modules/
│   └── health/
│       └── health.routes.ts
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
