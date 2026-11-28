import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export interface RenderedImage {
  uri: string;
  base64?: string;
  width: number;
  height: number;
}

/**
 * Görseli platformdan bağımsız olarak hazırlar: uzun kenarı sınırlar ve
 * JPEG'e çevirir. Yeniden kodlama EXIF verisini düşürür.
 *
 * `base64` yalnızca web'de istenir; native tarafta dosya kopyalanır.
 */
export async function renderJpeg(input: {
  sourceUri: string;
  sourceWidth?: number;
  maxWidth: number;
  compress: number;
  base64?: boolean;
}): Promise<RenderedImage> {
  const context = ImageManipulator.manipulate(input.sourceUri, { maxWidth: input.maxWidth });

  if (input.sourceWidth && input.sourceWidth > input.maxWidth) {
    context.resize({ width: input.maxWidth });
  }

  const rendered = await context.renderAsync();

  return rendered.saveAsync({
    compress: input.compress,
    format: SaveFormat.JPEG,
    base64: input.base64,
  });
}
