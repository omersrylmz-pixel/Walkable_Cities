import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import {
  IMAGE_COMPRESS,
  MAX_IMAGE_WIDTH,
  WEB_IMAGE_COMPRESS,
  WEB_MAX_IMAGE_WIDTH,
} from './config';

const QUEUE_DIR_NAME = 'ihbar-kuyrugu';
const isWeb = Platform.OS === 'web';

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Fotoğrafı yükleme için hazırlar: uzun kenarı sınırlar, JPEG olarak
 * yeniden sıkıştırır (EXIF bu aşamada düşer) ve belge dizinine kopyalar.
 * Kopya, uygulama kapansa da kuyruk kaydının görsele erişebilmesini sağlar.
 *
 * Tarayıcıda dosya sistemi yoktur; görsel data URL olarak döndürülür.
 * Blob URL sayfa yenilenince geçersiz olacağı için kuyrukla birlikte
 * saklanabilecek kalıcı bir gösterim gerekir.
 */
export async function prepareImage(
  sourceUri: string,
  clientReportId: string,
  sourceWidth?: number,
): Promise<PreparedImage> {
  const maxWidth = isWeb ? WEB_MAX_IMAGE_WIDTH : MAX_IMAGE_WIDTH;
  const context = ImageManipulator.manipulate(sourceUri, { maxWidth });

  if (sourceWidth && sourceWidth > maxWidth) {
    context.resize({ width: maxWidth });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: isWeb ? WEB_IMAGE_COMPRESS : IMAGE_COMPRESS,
    format: SaveFormat.JPEG,
    base64: isWeb,
  });

  if (isWeb) {
    if (!saved.base64) {
      throw new Error('Görsel tarayıcı için kodlanamadı');
    }

    return {
      uri: `data:image/jpeg;base64,${saved.base64}`,
      width: saved.width,
      height: saved.height,
    };
  }

  const queueDir = new Directory(Paths.document, QUEUE_DIR_NAME);
  queueDir.create({ idempotent: true, intermediates: true });

  const destination = new File(queueDir, `${clientReportId}.jpg`);
  await new File(saved.uri).copy(destination, { overwrite: true });

  return { uri: destination.uri, width: saved.width, height: saved.height };
}

/** Yükleme tamamlandığında veya kayıt silindiğinde geçici görseli kaldırır. */
export function deletePreparedImage(uri: string): void {
  // Web'de görsel data URL'dir; silinecek dosya yoktur.
  if (isWeb) {
    return;
  }

  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Görsel zaten silinmiş olabilir; kuyruk kaydı yine de kaldırılmalı.
  }
}
