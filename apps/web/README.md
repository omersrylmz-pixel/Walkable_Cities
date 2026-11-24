# Belediye Yönetim Paneli (Next.js + MapLibre)

İhbar kuyruğunu, karar süreçlerini ve mekânsal dağılımı belediye personeline sunan web paneli.
Faz 4 kapsamında çalışır durumdadır.

## Durum

| Alan | Durum |
| --- | --- |
| Next.js 15 (App Router) + React 19 + Tailwind | ✅ |
| HMAC imzalı çerez oturumu, rol bazlı erişim | ✅ |
| Panel KPI'ları, ihbar listesi, inceleme kuyruğu | ✅ |
| Karar formu + değiştirilemez denetim kaydı (audit) | ✅ |
| MapLibre nokta kümeleme, popup, H3 choropleth | ✅ |
| 10.000 nokta kümeleme yük testi | ✅ |
| WCAG 2.1 AA hedefli erişilebilirlik, mobil menü | ✅ |
| Karar eşiklerini panelden düzenleme | ⏳ Faz 5 |
| Sunucu tarafı H3 agregasyonu / Gi* sıcak nokta | ⏳ Faz 5 |

## Sayfalar

| Rota | Açıklama | Roller |
| --- | --- | --- |
| `/login` | Demo kullanıcı veya Supabase e-posta/parola girişi | Herkes |
| `/dashboard` | Toplam ihbar, kuyruk, otomatik kabul oranı, tür dağılımı | Tüm roller |
| `/review` | Manuel karar bekleyen ihbarlar (güven skoruna göre) | `moderator`, `municipality_admin` |
| `/review/[id]` | Görsel, ön değerlendirme, karar formu ve audit kaydı | `moderator`, `municipality_admin` |
| `/reports` | Durum, tür ve skor filtreli sayfalı liste | Tüm roller |
| `/map` | Nokta kümeleme + H3 yoğunluk choropleth | Tüm roller |

## Kimlik Doğrulama ve Roller

- Oturum, `WEB_SESSION_SECRET` ile HMAC-SHA256 imzalanmış `yaya_session` çerezinde tutulur
  (`httpOnly`, `sameSite=lax`, üretimde `secure`). Süre: 8 saat.
- `src/middleware.ts` korumalı rotaları çerez doğrulamasıyla korur; oturumsuz istekler
  `/login?next=...` adresine yönlendirilir.
- Roller: `municipality_admin`, `moderator`, `viewer`.
  - `viewer` inceleme kuyruğuna ve orijinal görsele erişemez (403 / panele yönlendirme).
  - Orijinal görsel yalnızca `moderator` ve `municipality_admin` rollerine açılır.
- **Geliştirme modu:** `WEB_DEV_AUTH=true` iken sabit UUID'li üç demo kullanıcı ile giriş yapılır.
  Bu UUID'ler `infra/init.sql` içinde `app_user` tablosuna seed edilir; audit `actor_id` yabancı
  anahtarı bu sayede geçerlidir.
- **Supabase:** `SUPABASE_URL` + `SUPABASE_ANON_KEY` tanımlıysa panel Supabase password grant
  kullanır; rol `app_metadata.role` veya `user_metadata.role` alanından okunur (yoksa `viewer`).
  Üretimde Supabase kullanıcıları `app_user` tablosuna senkronize edilmelidir; aksi halde karar
  kaydı `report_audit_log_actor_id_fkey` hatası verir.

## Karar Akışı ve Audit

- Karar, Next.js server action (`src/app/(panel)/review/[id]/actions.ts`) üzerinden API'ye
  `PATCH /v1/reports/:id/decision` olarak iletilir.
- API hem `report.decision.manual` hem de trigger kaynaklı `report.status_changed` audit kaydı
  yazar. Gerekçe (`note`) ve aktör kimliği audit payload'ında saklanır.
- Daha önce karar verilmiş kayıtlar için "Mevcut kararı geçersiz kıl" onayı zorunludur.
- Orijinal görsel `/api/reports/[id]/images/[kind]` proxy'sinden geçer; proxy oturum ve rol
  kontrolünü sunucu tarafında yapar, API anahtarı tarayıcıya sızmaz.

## Harita

- **Nokta katmanı:** MapLibre GeoJSON kaynağı + kümeleme (`clusterRadius: 55`,
  `clusterMaxZoom: 14`). Küme sayıları glyph sağlayıcısından metin olarak çizilir.
- **10.000 nokta testi:** "10.000 nokta testi" düğmesi deterministik sentetik veri üretir;
  kümeleme performansını doğrulamak için kullanılır.
- **H3 choropleth:** Tüm kayıtlar görselleştirme için **7. çözünürlükte** (yaklaşık 5 km² hücre)
  yeniden hesaplanır. Böylece 9. çözünürlüklü rapor hücreleri şehir ölçeğinde okunabilir kalır.
  Renk skalası hücredeki ihbar sayısına göre dinamik hesaplanır.
- **Worker:** MapLibre web worker'ı Next.js production build'inde kendi chunk'ından çözülemediği
  için `scripts/copy-maplibre-worker.mjs` ile `public/maplibre-gl-worker.mjs` altına kopyalanır ve
  `setWorkerUrl('/maplibre-gl-worker.mjs')` ile gösterilir. `predev`, `prebuild` ve `prestart`
  script'leri bu kopyalamayı otomatik yapar. Üretilen dosya `.gitignore` içindedir.
- Altlık varsayılan olarak OpenStreetMap raster'dır. `NEXT_PUBLIC_MAP_STYLE_URL` ile MapLibre
  Style JSON adresi verilebilir.

## Ortam Değişkenleri

| Değişken | Açıklama | Varsayılan |
| --- | --- | --- |
| `API_INTERNAL_URL` | Panelin sunucu tarafından bağlandığı API adresi | `http://localhost:3001` |
| `WEB_SESSION_SECRET` | Oturum çerezini imzalayan sır (üretimde zorunlu) | geliştirme varsayılanı |
| `WEB_DEV_AUTH` | Demo kullanıcı girişini açar/kapatır | `NODE_ENV !== production` |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Supabase Auth (opsiyonel) | — |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre stil URL'si (opsiyonel) | OSM raster |

## Komutlar

```bash
# kökten
npm run web:dev      # http://localhost:3002
npm run web:build
npm run web:start
npm run web:test
npm run typecheck
```

## Testler

- `npm run web:test` — oturum imzalama/doğrulama, H3 agregasyonu ve biçimlendirme testleri.
- `npm run typecheck` — tüm workspace'lerde TypeScript kontrolü.
- Faz 4 doğrulaması Playwright (Edge) ile uçtan uca yapıldı: giriş → kuyruk → ret kararı →
  audit görünümü → harita → 10.000 nokta → H3 → mobil görünüm.

## Faz 4 Kabul Kriterleri

- [x] Personel girişi ve rol bazlı yetkilendirme
- [x] Manuel inceleme kuyruğu ve karar akışı uçtan uca çalışıyor
- [x] Karar sonrası audit kaydı gerekçe ve aktörle birlikte yazılıyor
- [x] Haritada nokta kümeleme ve H3 choropleth görüntüleniyor
- [x] 10.000 noktada kümeleme akıcı çalışıyor (yük testi düğmesi)
- [x] Yetkisiz rol orijinal görsele erişemiyor (403)
- [ ] Karar eşikleri panelden güncellenebiliyor (audit log ile) — Faz 5'e ertelendi
- [ ] Gi* sıcak/soğuk nokta katmanı — Faz 5'e ertelendi
