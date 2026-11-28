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

### Tarayıcıda çalıştırma

Tarayıcıda vatandaş akışını denemek için:

```bash
npm run mobile:start      # ardından terminalde "w" tuşuna basın
# veya doğrudan:
npx expo start --web --port 8081
```

- Kamera ve konum yalnızca **localhost** veya HTTPS üzerinde çalışır; `http://<LAN-IP>:8081`
  adresinde tarayıcı izin vermez.
- API'nin CORS listesinde `http://localhost:8081` bulunmalıdır
  (`CORS_ORIGINS=http://localhost:3002,http://localhost:8081`).
- Web'de görsel, tarayıcı depolamasına sığması için 1280 px / JPEG q=0.7 ve
  **data URL** olarak saklanır. Bu sayede sayfa yenilense bile çevrimdışı kayıt
  gönderilebilir; tarayıcı kotası nedeniyle web yalnızca demo içindir.
- Fiziksel cihazda kuyruk görselleri belge dizininde tutulur ve 1920 px / q=0.85
  kullanılır.

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

Web'de belge dizini yoktur: görsel 1280 px / q=0.7 hazırlanır ve kuyrukla
birlikte data URL olarak saklanır. Gönderimde data URL `Blob`'a çevrilip
multipart gövdesine eklenir; native tarafta `{ uri, name, type }` kullanılır.

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
│       ├── media-core.ts    # platformdan bağımsız boyutlandırma + JPEG
│       ├── media.ts         # native: belge dizinine kalıcı kopya
│       ├── media.web.ts     # web: data URL (kalıcı tarayıcı kuyruğu)
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
| Görsel uzun kenarı | 1920 px (web: 1280 px) |
| JPEG kalitesi | 0.85 (web: 0.70) |
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
- [x] Tarayıcıda uçtan uca: kamera → GPS → gönderim → panelde kayıt
- [x] Tarayıcıda çevrimdışı kuyruk: yenileme sonrası kayıt korunuyor ve bağlantı gelince gönderiliyor
- [ ] Fiziksel cihazda saha testi (Faz 1 kapanışı)
