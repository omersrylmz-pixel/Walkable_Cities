# Yol Haritası

Her faz küçük, test edilebilir ve commit'lenebilir adımlardan oluşur. Bir faz ancak kabul kriterleri sağlandığında kapanır.

---

## Faz 0 — Proje İskeleti ve Altyapı ✅

**Hedef:** Teknik omurganın kurulması.

- [x] Monorepo dizin yapısı (`apps/mobile`, `apps/web`, `services/api`, `services/ai-service`, `ml-pipeline`, `infra`)
- [x] Kök `README.md`, `CONTRIBUTING.md`, `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] `docker-compose.yml`: PostGIS + h3-pg PostgreSQL, FastAPI, Node API
- [x] `infra/init.sql`: enum'lar, tablolar, trigger'lar, indeksler, view/MV, seed
- [x] Karar eşikleri ve 3 aşamalı karar fonksiyonu
- [x] Servis iskeletleri (Fastify health, FastAPI health)
- [x] `.env.example` şablonları
- [x] Mimari ve yol haritası dokümanları
- [x] İlk commit + push

**Kabul kriterleri**

- `docker compose config` hatasız
- `docker compose up -d postgres` sonrası `init.sql` hatasız çalışıyor
- `decision_for_score(0.9/0.7/0.4)` sırasıyla `auto_accept / manual_review / auto_reject` dönüyor
- API ve AI servisleri `/health` uçlarında 200 dönüyor

---

## Faz 1 — Mobil İskelet ve İhbar Toplama

**Hedef:** Uçtan uca "çek → doğrula → gönder → kaydet" akışının ilk sürümü.

**Mobil**
- [x] Expo + TypeScript + expo-router iskeleti
- [x] `expo-camera` ile canlı çekim; galeri erişimi kapalı
- [x] `expo-location` ile GPS; doğruluk eşiği ve yeniden deneme
- [x] Zaman damgası + sunucu saat farkı kontrolü
- [x] Yerel kuyruk (çevrimdışı) + idempotent yeniden gönderim
- [x] `client_report_id` üretimi ve kalıcılığı

**API**
- [x] PostgreSQL bağlantı havuzu (`pg`) ve migrasyon altyapısı (node-pg-migrate)
- [x] `POST /v1/reports` multipart + zod doğrulama
- [x] Idempotency ve SHA-256 mükerrer kontrolü
- [x] Görsel depolama adaptörü (`local` / `supabase`)
- [x] `GET /v1/reports/:id`, `GET /v1/reports`

**Kabul kriterleri**
- Aynı `clientReportId` iki kez gönderildiğinde tek kayıt oluşuyor
- Çevrimdışı çekilen ihbar bağlantı gelince otomatik yükleniyor
- Gelecek zamanlı `capturedAt` 422 ile reddediliyor
- Görsel `report_images` tablosuna SHA-256 ile yazılıyor

---

## Faz 2 — Yapay Zekâ Servisi 🚧

**Hedef:** Gerçek çıkarım hattı ve overlap hesabı.

- [x] `ml-pipeline`: veri seti dönüştürücüleri, etiket doğrulama raporu
- [ ] YOLO26 eğitimi + RF-DETR karşılaştırması (mAP50, mAP50-95)
- [ ] Kaldırım / yaya geçidi segmentasyon modeli (mIoU raporu)
- [x] ONNX export yardımcısı + `onnxruntime` oturum yönetimi
- [x] `POST /v1/analyze`: görsel -> tespitler + maske + `overlap_ratio`
- [x] Skor füzyonu + kalibrasyon (temperature scaling)
- [x] Model warm-up, sürüm raporu, gecikme ölçümü
- [x] AI servisi için birim testleri (sentetik görsellerle)

> **Durum notu:** API sözleşmesi, overlap/skor/karar hattı ve testler hazır. Gerçek veri seti, GPU ve eğitilmiş ağırlıklar olmadığı için YOLO26/RF-DETR eğitimi, segmentasyon mIoU raporu ve 20 görsellik saha ölçümü açık. Ağırlık yokken geliştirme/CI için deterministik `heuristic` yedek hat kullanılır (`ALLOW_HEURISTIC_FALLBACK`, üretimde `false`).

**Kabul kriterleri**
- [ ] 20 görsellik doğrulama setinde uçtan uca analiz < 2 s/görsel (CPU)
- [ ] Overlap hesabı, elle işaretlenmiş 10 örnekle ±0.05 toleransta
- [x] Aynı görsel + aynı model sürümü deterministik sonuç veriyor (sentetik test)

---

## Faz 3 — KVKK, Mükerrer Kontrol ve Karar Hattı

**Hedef:** Üretime yakın veri güvenliği ve karar doğruluğu.

- [x] Yüz/plaka tespiti + Gauss bulanıklaştırma (orijinal ayrı saklanır; heuristic hat, gerçek model bekliyor)
- [x] EXIF temizleme ve GPS/zaman çapraz doğrulama
- [x] Konum + zaman + hash tabanlı mükerrer skorlama
- [x] Karar servisi: DB eşiklerini açılışta okuma, audit log yazımı
- [x] `GET /v1/review-queue`, `PATCH /v1/reports/:id/decision`, `GET /v1/reports/:id/audit`
- [x] Saklama süresi temizlik işi (`npm run retention:purge`)
- [x] Entegrasyon testleri (compose tabanlı): `npm run test:integration --workspace @yaya/api`

**Kabul kriterleri**
- Yüz ve plaka içeren test görsellerinde ilgili bölgeler bulanık
- Aynı görselin tekrar yüklenmesi `duplicate_of` işaretliyor
- Skor 0.85 / 0.60 sınırlarında doğru duruma geçiyor
- Manuel karar sonrası skor güncellense bile karar korunuyor

---

## Faz 4 — Belediye Paneli

**Hedef:** Moderatör ve yönetici için kullanılabilir arayüz.

- [ ] Next.js 15 + Tailwind + shadcn/ui iskeleti
- [ ] Supabase Auth ile giriş, rol bazlı middleware
- [ ] Dashboard KPI kartları
- [ ] İnceleme kuyruğu + karar formu + audit görünümü
- [ ] MapLibre: nokta katmanı, kümeleme, popup
- [ ] H3 choropleth katmanı (`h3-js`)
- [ ] Erişilebilirlik (WCAG 2.1 AA) ve responsive tasarım

**Kabul kriterleri**
- Moderatör bir ihbarı kabul/ret edebiliyor, karar audit log'a yazılıyor
- Harita 10.000 noktada akıcı (60 fps hedefi, kümeleme ile)
- Yetkisiz rol orijinal görsele erişemiyor

---

## Faz 5 — Mekânsal Analiz

**Hedef:** Sıcak nokta ve önceliklendirme.

- [ ] H3 agregasyon servisi + `mv_h3_density` yenileme stratejisi
- [ ] DBSCAN (scikit-learn / PostGIS kümeleme) ve parametre seçimi
- [ ] Getis-Ord Gi* hesabı (H3 k-ring komşuluğu, Monte Carlo p-değeri)
- [ ] `POST /v1/hotspots/analyze`, `GET /v1/hotspots/:id`
- [ ] Panelde Gi* sıcak/soğuk nokta ve DBSCAN küme katmanları
- [ ] Müdahale öncelik skoru (yoğunluk + ağırlık + güncellik)

**Kabul kriterleri**
- Bilinen yoğun bölge, Gi* ile %95 güvenle `hot` sınıfında
- DBSCAN gürültü oranı raporlanıyor; parametreler dokümante
- Analiz tekrar çalıştırıldığında deterministik (seed sabit)

---

## Faz 6 — Test, CI/CD ve Gözlemlenebilirlik

**Hedef:** Sürdürülebilir kalite.

- [ ] API birim + entegrasyon testleri (Vitest), kapsam raporu
- [ ] AI servisi pytest + örnek görsel fixture'ları
- [ ] Mobil bileşen testleri (Jest + Testing Library)
- [ ] GitHub Actions: lint, typecheck, test, docker build
- [ ] Yapılandırılmış log + korelasyon kimliği
- [ ] Metrikler: istek süresi, karar dağılımı, kuyruk yaşı, AI gecikmesi
- [ ] Yedekleme / geri yükleme tatbikatı

**Kabul kriterleri**
- CI tüm testleri yeşil geçiyor
- Ortalama API yanıtı (p95) < 300 ms (AI hariç)
- Yedekten geri yükleme doğrulandı

---

## Faz 7 — Saha Pilotu ve Raporlama

**Hedef:** Gerçek veriyle doğrulama ve TÜBİTAK çıktıları.

- [ ] Pilot bölge seçimi ve belediye iş birliği
- [ ] 4 haftalık saha verisi toplama
- [ ] Model doğruluğu ve karar eşiği kalibrasyonu
- [ ] Kullanıcı memnuniyeti ve süreç kazancı ölçümü
- [ ] TÜBİTAK ara rapor / sonuç raporu
- [ ] Akademik bildiri taslağı

**Kabul kriterleri**
- Otomatik kabul precision ≥ 0.90 (pilot set)
- Manuel inceleme yükü, toplam ihbarların < %35'i
- Belediye personeli tarafından uçtan uca kullanım doğrulandı

---

## Faz Bağımlılıkları

```text
Faz 0 ──> Faz 1 ──> Faz 2 ──> Faz 3 ──> Faz 4 ──> Faz 5 ──> Faz 6 ──> Faz 7
              \         \         \         /
               └─────────┴─────────┴────────┘
                 (paralel yürütülebilir çiftler:
                  Faz 1 + Faz 2, Faz 4 + Faz 5)
```

> Her faz sonunda: `git status` → Conventional Commit → push. Push öncesi remote tanımlı değilse repo URL'si istenir.
