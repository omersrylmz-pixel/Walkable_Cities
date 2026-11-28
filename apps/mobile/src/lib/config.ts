import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Android emülatöründe `localhost` cihazın kendisidir; host makineye
 * 10.0.2.2 üzerinden erişilir. Fiziksel cihazda EXPO_PUBLIC_API_URL
 * ortam değişkeni ile LAN adresi verilmelidir.
 */
function defaultApiUrl(): string {
  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'http://10.0.2.2:3001';
  }
  return 'http://localhost:3001';
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? defaultApiUrl()).replace(/\/+$/, '');

export const APP_VERSION = Constants.expoConfig?.version ?? '0.1.0';

/** GPS doğruluğu hedefi: bu değere ulaşmak için yeniden denenir. */
export const TARGET_GPS_ACCURACY_M = 25;

/** Bu değerin üzerindeki konum doğruluğuyla gönderim engellenir. */
export const HARD_GPS_ACCURACY_M = 50;

/** |fark| bu eşiği aşarsa cihaz saati uyarısı gösterilir. */
export const CLOCK_DRIFT_WARN_SECONDS = 120;

/** Yükleme öncesi görselin uzun kenarı (px). */
export const MAX_IMAGE_WIDTH = 1920;

/** JPEG sıkıştırma kalitesi (0–1). */
export const IMAGE_COMPRESS = 0.85;

/**
 * Web'de görsel, tarayıcı depolamasına sığması için data URL olarak kuyruğa
 * yazılır. Daha küçük boyut ve daha yüksek sıkıştırma, localStorage kotasını
 * aşmadan birkaç ihbarın çevrimdışı beklemesini sağlar.
 */
export const WEB_MAX_IMAGE_WIDTH = 1280;
export const WEB_IMAGE_COMPRESS = 0.7;
