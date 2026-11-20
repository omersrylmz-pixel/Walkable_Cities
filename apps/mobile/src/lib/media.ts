import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { IMAGE_COMPRESS, MAX_IMAGE_WIDTH } from './config';

const QUEUE_DIR_NAME = 'ihbar-kuyrugu';

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Fotoğrafı yükleme için hazırlar: uzun kenarı sınırlar, JPEG olarak
 * yeniden sıkıştırır (EXIF bu aşamada düşer) ve belge dizinine kopyalar.
 * Kopya, uygulama kapansa da kuyruk kaydının görsele erişebilmesini sağlar.
 */
export async function prepareImage(
  sourceUri: string,
  clientReportId: string,
  sourceWidth?: number,
): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(sourceUri, { maxWidth: MAX_IMAGE_WIDTH });

  if (sourceWidth && sourceWidth > MAX_IMAGE_WIDTH) {
    context.resize({ width: MAX_IMAGE_WIDTH });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: IMAGE_COMPRESS,
    format: SaveFormat.JPEG,
  });

  const queueDir = new Directory(Paths.document, QUEUE_DIR_NAME);
  queueDir.create({ idempotent: true, intermediates: true });

  const destination = new File(queueDir, `${clientReportId}.jpg`);
  await new File(saved.uri).copy(destination, { overwrite: true });

  return { uri: destination.uri, width: saved.width, height: saved.height };
}

/** Yükleme tamamlandığında veya kayıt silindiğinde geçici görseli kaldırır. */
export function deletePreparedImage(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Görsel zaten silinmiş olabilir; kuyruk kaydı yine de kaldırılmalı.
  }
}
