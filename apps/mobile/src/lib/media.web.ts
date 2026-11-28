import { WEB_IMAGE_COMPRESS, WEB_MAX_IMAGE_WIDTH } from './config';
import { renderJpeg } from './media-core';

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Tarayıcıda dosya sistemi yoktur; görsel data URL olarak döndürülür.
 * Blob URL sayfa yenilenince geçersiz olacağı için kuyrukla birlikte
 * saklanabilecek kalıcı bir gösterim gerekir.
 *
 * Boyut ve sıkıştırma web için daha küçüktür: kayıtlar tarayıcı
 * depolamasında (localStorage) tutulur ve kota sınırlıdır.
 */
export async function prepareImage(
  sourceUri: string,
  _clientReportId: string,
  sourceWidth?: number,
): Promise<PreparedImage> {
  const saved = await renderJpeg({
    sourceUri,
    sourceWidth,
    maxWidth: WEB_MAX_IMAGE_WIDTH,
    compress: WEB_IMAGE_COMPRESS,
    base64: true,
  });

  if (!saved.base64) {
    throw new Error('Görsel tarayıcı için kodlanamadı');
  }

  return {
    uri: `data:image/jpeg;base64,${saved.base64}`,
    width: saved.width,
    height: saved.height,
  };
}

/** Web'de görsel data URL'dir; silinecek dosya yoktur. */
export function deletePreparedImage(_uri: string): void {
  // No-op: kuyruk kaydı silinince data URL de referanssız kalır.
}
