# Mobil Uygulama (React Native + Expo)

Vatandaşın sahada **yalnızca canlı kamera** ile ihlal fotoğrafı çektiği, GPS + zaman damgası doğrulaması yapıp veriyi API'ye paketlediği uygulama.

> **Faz 0 durumu:** Dizin ve planlama tamamlandı. Expo iskeleti **Faz 1**'de kurulacak.

## Tasarım İlkeleri

1. **Galeriden yükleme yok.** Sadece `expo-camera` ile canlı çekim; bağlam doğruluğu ve kötüye kullanımın önlenmesi için.
2. **Kanıt zinciri.** Her ihbar; çekim zamanı, GPS koordinatı, doğruluk yarıçapı, cihaz saati ve sunucu saat farkı ile paketlenir.
3. **Çevrimdışı öncelikli.** Bağlantı yoksa ihbar cihazda kuyruğa alınır, bağlantı gelince idempotent (`client_report_id`) şekilde gönderilir.
4. **Minimum veri.** Görsel cihaz galerisine kaydedilmez; yalnızca uygulama kum havuzunda tutulur ve başarılı yüklemeden sonra silinir.

## Planlanan Teknolojiler

| Paket | Amaç |
| --- | --- |
| `expo` (SDK 52+) | Uygulama çatısı, EAS Build |
| `expo-camera` | Canlı kamera, çekim |
| `expo-location` | GPS, doğruluk (accuracy) takibi |
| `expo-secure-store` | Oturum token'ı |
| `expo-file-system` | Çevrimdışı kuyruk ve geçici dosyalar |
| `expo-image-manipulator` | Yeniden boyutlandırma (yükleme öncesi) |
| `@react-native-community/netinfo` | Bağlantı durumu |
| `react-native-mmkv` (veya AsyncStorage) | Kuyruk meta verisi |

## Çekim ve Doğrulama Akışı

```text
[Kamera izni] -> [Canlı önizleme + konum katmanı]
      -> [Çekim]
      -> [GPS: accuracy <= 25 m olana kadar bekle / en iyi örneği al]
      -> [Zaman: cihaz saati + capture timestamp (ISO 8601, UTC)]
      -> [Sunucu saat farkı kontrolü: |drift| > 120 s ise uyar]
      -> [Yerel ön işleme: max 1920 px, JPEG q=85]
      -> [JSON paket + multipart upload]
      -> [201 Created -> kuyruktan sil]
      -> [Ağ hatası -> kuyrukta tut, üstel geri çekilme ile yeniden dene]
```

## Gönderilecek Paket (hedef sözleşme)

```json
{
  "clientReportId": "3f1c9b0e-6d1e-4c2e-9a57-0b6f5c1d2e44",
  "violationType": "kaldirim_isgali",
  "capturedAt": "2026-11-19T09:14:22.512Z",
  "location": {
    "latitude": 39.7477,
    "longitude": 37.0179,
    "accuracyM": 8.4,
    "source": "device"
  },
  "device": {
    "platform": "android",
    "osVersion": "15",
    "appVersion": "0.1.0",
    "clockDriftSeconds": 12
  },
  "description": "Kaldırımda park etmiş araç",
  "image": "<multipart dosyası, EXIF temizlenmiş>"
}
```

> Görsel ayrı multipart parçası olarak gönderilir; JSON alanı `report` adıyla taşınır. API tarafı Faz 1'de bu sözleşmeyi zod ile doğrulayacak.

## Planlanan Klasör Yapısı

```text
apps/mobile/
├── app/                    # expo-router sayfaları
│   ├── (auth)/
│   ├── capture.tsx
│   ├── report/[id].tsx
│   └── _layout.tsx
├── src/
│   ├── api/                # API istemcisi, retry, idempotency
│   ├── components/         # kamera overlay, GPS rozeti, form alanları
│   ├── features/           # capture, queue, auth
│   ├── lib/                # tarih, konum, hash yardımcıları
│   ├── store/              # kuyruk ve oturum durumu
│   └── theme/
├── assets/
├── app.json
├── eas.json
└── package.json
```

## İzinler

| Platform | İzin | Gerekçe |
| --- | --- | --- |
| Android | `CAMERA`, `ACCESS_FINE_LOCATION` | Canlı çekim ve konum |
| iOS | `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription` | Aynı |

## Faz 1 Kabul Kriterleri

- [ ] Expo projesi TypeScript ile ayağa kalkıyor
- [ ] Canlı kamera çekimi ve galeri erişimi kapalı
- [ ] GPS doğruluk eşiği ve zaman kayması kontrolü uygulanıyor
- [ ] Çevrimdışı kuyruk + idempotent yeniden gönderim çalışıyor
- [ ] `client_report_id` ile tekrar gönderimde mükerrer kayıt oluşmuyor
