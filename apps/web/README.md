# Belediye Yönetim Paneli (Next.js + MapLibre)

İhbar kuyruğunu, karar durumlarını ve mekânsal sıcak nokta analizlerini belediye personeline sunan web paneli.

> **Faz 0 durumu:** Dizin ve planlama tamamlandı. Next.js iskeleti **Faz 4**'te kurulacak.

## Planlanan Teknolojiler

| Paket | Amaç |
| --- | --- |
| Next.js 15 (App Router) | SSR/ISR, route handler'lar, auth middleware |
| TypeScript | Uçtan uca tip güvenliği |
| Tailwind CSS + shadcn/ui | Hızlı ve tutarlı arayüz |
| MapLibre GL JS | Vektör harita, ısı haritası, H3 katmanları |
| `h3-js` | H3 hücre -> poligon dönüşümü |
| TanStack Query | Sunucu durumu, önbellek |
| Supabase Auth (`@supabase/ssr`) | Belediye personeli oturumu |
| Recharts / visx | Zaman serisi ve tür dağılımı grafikleri |

## Planlanan Sayfalar

| Rota | Açıklama |
| --- | --- |
| `/login` | Personel girişi |
| `/dashboard` | Özet KPI'lar: günlük ihbar, otomatik kabul oranı, kuyruk yaşı |
| `/review` | 0.60 – 0.84 bandındaki manuel inceleme kuyruğu |
| `/review/[id]` | Görsel + AI tespitleri + karar formu (kabul/ret, gerekçe) |
| `/reports` | Filtrelenebilir ihbar listesi (tür, durum, tarih, mahalle) |
| `/map` | MapLibre: nokta, H3 choropleth, Gi* sıcak/soğuk noktalar |
| `/hotspots` | DBSCAN / Getis-Ord Gi* analiz geçmişi ve karşılaştırma |
| `/settings` | Karar eşikleri, saklama süresi, kullanıcı yönetimi |

## Harita Katmanları

1. **Nokta katmanı** — tekil ihbarlar (kümeleme + popup).
2. **H3 choropleth** — `mv_h3_density` hücreleri, çözünürlük seçilebilir (7/8/9/10).
3. **Gi* sıcak nokta** — `hotspot_cells` z-skoru ve p-değeri ile renklendirme.
4. **DBSCAN kümeleri** — yoğunluk kümelerinin sınır poligonları.
5. **Isı haritası** — yoğunluk hızlı bakış (performans için MapLibre heatmap).

Renk skalası: sıcak noktalar kırmızı-turuncu, soğuk noktalar mavi; `not_significant` gri ve düşük opaklık.

## Veri Erişimi

- Panel doğrudan veritabanına bağlanmaz; API üzerinden okur.
- Ağır mekânsal sorgular (`mv_h3_density`, `hotspot_cells`) API'de önbelleklenir (SWR + ETag).
- Kişisel veri içeren orijinal görseller yalnızca `moderator` / `municipality_admin` rolüne sunulur; anonimleştirilmiş kopya varsayılandır.

## Planlanan Klasör Yapısı

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx
│   │   ├── (panel)/dashboard/page.tsx
│   │   ├── (panel)/review/page.tsx
│   │   ├── (panel)/map/page.tsx
│   │   └── layout.tsx
│   ├── components/
│   │   ├── map/            # MapLibre sarmalayıcı, katmanlar, legend
│   │   ├── review/         # karar formu, görsel karşılaştırma
│   │   └── ui/             # shadcn bileşenleri
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── h3.ts
│   │   └── auth.ts
│   └── styles/
├── public/
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

## Faz 4 Kabul Kriterleri

- [ ] Personel girişi ve rol bazlı yetkilendirme
- [ ] Manuel inceleme kuyruğu ve karar akışı uçtan uca çalışıyor
- [ ] Haritada nokta + H3 choropleth + Gi* katmanları görüntüleniyor
- [ ] Karar eşikleri panelden güncellenebiliyor (audit log ile)
