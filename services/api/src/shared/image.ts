import { createHash } from 'node:crypto';

export type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
export type SupportedImageExtension = 'jpg' | 'png' | 'webp';

export interface DetectedImage {
  mimeType: SupportedImageMime;
  extension: SupportedImageExtension;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Dosya uzantısına/MIME başlığına güvenmek yerine ilk baytlardan tür tespiti.
 * Yüklenen içeriğin gerçekten desteklenen bir görsel olduğunu doğrular.
 */
export function detectImageType(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  const riff = buffer.subarray(0, 4).toString('ascii');
  const webp = buffer.subarray(8, 12).toString('ascii');
  if (riff === 'RIFF' && webp === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  return null;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * SHA-256 özetini PostgreSQL `bytea` alanına yazılacak Buffer'a çevirir.
 * (Repository katmanı hex string yerine ham 32 baytı saklar.)
 */
export function sha256Buffer(buffer: Buffer): Buffer {
  return createHash('sha256').update(buffer).digest();
}

export function extensionForMime(mimeType: string): SupportedImageExtension | null {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}
