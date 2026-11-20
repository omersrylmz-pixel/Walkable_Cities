# Mobil Uygulama (React Native + Expo)

Vatandaşın sahada **yalnızca canlı kamera** ile ihlal fotoğrafı çektiği, GPS + zaman
damgası doğrulaması yapıp veriyi API'ye paketlediği uygulama.

> **Durum (Faz 1):** Expo SDK 58 iskeleti, canlı kamera, GPS doğruluk yönetimi,
> saat farkı kontrolü, çevrimdışı kuyruk ve idempotent gönderim uygulandı.
> Cihaz üzerinde saha testi bir sonraki adımdır.

## Hızlı Başlangıç

```bash
# depo kökünde
npm install
npm run mobile:start      # Expo geliştirme sunucusu
npm run mobile:android    # Android emülatörü
npm run mobile:ios        # iOS simülatörü (macOS)
```

API adresi:

| Ortam | Varsayılan adres |
| --- | --- |
| Android emülatörü | `http://10.0.2.2:3001` (otomatik) |
| iOS simülatörü / web | `http://localhost:3001` (otomatik) |
| Fiziksel cihaz | `.env` → `EXPO_PUBLIC_API_URL=http://<LAN-IP>:3001` |

## Tasarım İlkeleri

1. **Galeriden yükleme yok.** Yalnızca `expo-camera` ile canlı çekim; sahte/başlam
   doğrulaması ve kötüye kullanımın önlenmesi için.
2. **Kanıt zinciri.** Her ihbar; çekim zamanı, GPS koordinatı, doğruluk yarıçapı,
   cihaz saati ve sunucu saat farkı ile paketlenir.
3. **Çevrimdışı öncelikli.** Bağlantı yoksa ihbar cihazda kuyruğa alınır, bağlantı
   gelince idempotent (`clientReportId`) şekilde gönderilir.
4. **Minimum veri.** Görsel cihaz galerisine kaydedilmez; yalnızca uygulamanın belge
   dizinindeki kuyruk klasöründe tutulur ve başarılı yüklemeden sonra silinir.

## Akış

```text
[Kamera izni] -> [Canlı önizleme + GPS/saat rozetleri]
      -> [Fotoğraf çek]
      -> [GPS: hedef <= 25 m; en fazla 6 deneme, en iyi örnek]
      -> [Saat farkı: sunucu Date başlığı ile karşılaştır]
      -> [Görsel: max 1920 px, JPEG q=0.85, EXIF düşer]
      -> [Kuyruğa yaz (AsyncStorage + belge dizini)]
      -> [Multipart POST /v1/reports]
      -> [201/200 -> kuyruktan ve diskten sil]
      -> [Ağ hatası -> kuyrukta tut, bağlantıda otomatik dene]
```

## Klasör Yapısı

```text
apps/mobile/
├── app.json                 # izinler, plugin'ler, uygulama kimliği
├── src/
│   ├── app/
│   │   ├── _layout.tsx      # Stack + açılışta/bağlantıda kuyruk gönderimi
│   │   ├── index.tsx        # canlı kamera, GPS/saat durumu, çekim formu
│   │   └── queue.tsx        # gönderim kuyruğu, tekrar dene / sil
│   ├── hooks/useQueue.ts    # kuyruk aboneliği
│   └── lib/
│       ├── api.ts           # multipart istemci, hata sınıflandırma, saat farkı
│       ├── config.ts        # API URL, eşikler, görsel limitleri
│       ├── format.ts        # tarih/doğruluk biçimlendirme
│       ├── location.ts      # izin + hedefli GPS okuma
│       ├── media.ts         # yeniden boyutlandırma, JPEG, kalıcı kopya
│       ├── queue.ts         # AsyncStorage kuyruğu, eşzamanlı gönderim kilidi
│       └── types.ts         # ihlal türleri, QueueItem
```

## Doğrulama Kuralları

| Kural | Değer |
| --- | --- |
| GPS hedef doğruluğu | ≤ 25 m (yeniden denenir) |
| GPS sert sınır | > 50 m ise gönderim engellenir |
| Saat farkı uyarısı | \|fark\| > 120 sn |
| Saat farkı engeli | Cihaz 240 sn'den fazla ileriyse |
| Görsel uzun kenarı | 1920 px |
| JPEG kalitesi | 0.85 |
| Otomatik deneme | En fazla 8 (4xx kalıcı hata ise durur) |

## İzinler

| Platform | İzin | Gerekçe |
| --- | --- | --- |
| Android | `CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Canlı çekim ve konum |
| iOS | `NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription` | Aynı |

Ses kaydı izni istenmez (`recordAudioAndroid: false`).

## Faz 1 Kabul Durumu

- [x] Expo projesi TypeScript ile derleniyor (`tsc --noEmit`)
- [x] Canlı kamera çekimi; galeri erişimi yok
- [x] GPS doğruluk eşiği ve yeniden deneme
- [x] Saat kayması kontrolü ve uyarısı
- [x] Çevrimdışı kuyruk + idempotent yeniden gönderim
- [x] `clientReportId` ile tekrar gönderimde mükerrer kayıt oluşmuyor
- [ ] Fiziksel cihazda saha testi (Faz 1 kapanışı)
