# Altyapı (infra)

Bu dizin veritabanı şemasını, konteyner imajlarını ve operasyonel script'leri barındırır.

## Dosyalar

| Yol | Amaç |
| --- | --- |
| `init.sql` | PostgreSQL 16 + PostGIS + h3-pg başlangıç şeması (enum'lar, tablolar, trigger'lar, view'lar, seed) |
| `docker/postgres/Dockerfile` | `postgis/postgis:16-3.4` üzerine `postgresql-16-h3` kurulumu |
| `scripts/` | Yedekleme / geri yükleme / bakım script'leri (Faz 1'de doldurulacak) |

## Şema Özeti

### Tablolar

| Tablo | Açıklama |
| --- | --- |
| `violation_type_catalog` | 5 ihlal türünün Türkçe etiketleri ve varsayılan ağırlıkları |
| `system_setting` | Karar eşikleri (`decision.thresholds`) dahil çalışma zamanı ayarları |
| `app_user` | Vatandaş / moderatör / belediye yöneticisi / analist / servis hesapları |
| `reports` | Ana ihbar kaydı (konum, zaman, skor, karar, H3) |
| `report_images` | Görseller, SHA-256 mükerrer kontrolü, KVKK bulanıklaştırma sayaçları |
| `report_evaluations` | AI çalıştırma izleri (model, tespitler, overlap, karar) |
| `report_audit_log` | Durum geçişleri ve moderasyon denetim izi |
| `hotspot_analyses` / `hotspot_cells` | DBSCAN ve Getis-Ord Gi* sonuçları |
| `mv_h3_density` (MV) | H3 hücresi bazlı yoğunluk, sıcak nokta analizine girdi |
| `v_review_queue` (VIEW) | 0.60 – 0.84 bandındaki manuel inceleme kuyruğu |

### İhlal Türleri

| Enum değeri | Türkçe etiket | Varsayılan ağırlık |
| --- | --- | --- |
| `kaldirim_isgali` | Kaldırım İşgali | 4 |
| `yaya_gecidi_ihlali` | Yaya Geçidi İhlali | 5 |
| `sabit_engel` | Sabit Engel | 3 |
| `yuzey_bozulmasi` | Yüzey Bozulması | 3 |
| `gecici_engel` | Geçici Engel | 2 |

### Karar Mekanizması

`system_setting` içindeki `decision.thresholds` değeri:

```json
{ "auto_accept": 0.85, "manual_review": 0.60 }
```

`decision_for_score()` fonksiyonu bu eşikleri okur; `apply_report_decision` trigger'ı skor yazıldığında `decision` ve `status` alanlarını otomatik günceller. Manuel kararlar korunur.

Eşik değişikliği:

```sql
UPDATE system_setting
SET value = '{"auto_accept": 0.90, "manual_review": 0.65}'::jsonb
WHERE key = 'decision.thresholds';
```

> AI servisi ve API aynı değerleri `.env` üzerinden de okur. Üretimde tek doğruluk kaynağı veritabanı olmalı; servisler açılışta bu tabloyu okuyacak şekilde Faz 3'te bağlanacaktır.

## H3 Desteği

- h3-pg mevcutsa `reports` tablosuna yazılan her konum için `trg_reports_h3_cell` trigger'ı `h3_lat_lng_to_cell()` çağırır ve `h3_cell` alanını doldurur.
- h3-pg yoksa (ör. Supabase'de eklenti kapalıysa) trigger sessizce atlar; `h3_cell` API/AI katmanında `h3-js` / `h3` Python paketi ile hesaplanıp yazılır.
- Varsayılan çözünürlük **9** (~0.105 km² / ~174 m kenar). Yoğun kentsel analizde 10, mahalle ölçeğinde 8 kullanılabilir.

Yoğunluk view'ını yenileme:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_h3_density;
```

## Çalıştırma

```bash
# yalnızca veritabanı
docker compose up -d postgres

# şema kontrolü
docker compose exec postgres psql -U yaya -d yaya -c "\dt"
docker compose exec postgres psql -U yaya -d yaya -c "SELECT * FROM violation_type_catalog;"
docker compose exec postgres psql -U yaya -d yaya -c "SELECT decision_for_score(0.9), decision_for_score(0.7), decision_for_score(0.4);"

# temiz kurulum (volume silinir!)
docker compose down -v
docker compose up -d postgres
```

## Yedekleme (Faz 1'de script'lenecek)

```bash
docker compose exec -T postgres pg_dump -U yaya -d yaya -Fc > backup_$(date +%Y%m%d).dump
```

## Supabase ile Kullanım

1. Supabase projesinde **PostGIS** eklentisini etkinleştirin.
2. `infra/init.sql` dosyasını SQL Editor'de çalıştırın (h3 bloğu eklenti yoksa uyarı verip devam eder).
3. `DATABASE_URL` değerini Supabase pooler adresine yönlendirin (`?sslmode=require`).
4. `h3` eklentisi yoksa H3 hesaplaması uygulama katmanına düşer; `mv_h3_density` view'ı yine çalışır.

## Migrasyon Stratejisi

- Faz 0: `init.sql` (tek seferlik bootstrap).
- Faz 1+: `services/api/migrations/` altında sürümlü SQL migrasyonları (node-pg-migrate) ve `schema_migrations` tablosu.
- Mekânsal nesneler (view, MV, trigger) migrasyonlarda `CREATE OR REPLACE` ile yönetilir; kırıcı değişiklikler ayrı migration dosyasına yazılır.
