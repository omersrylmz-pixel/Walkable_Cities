import { describe, expect, it } from 'vitest';

import { detectImageType, extensionForMime, sha256Hex } from '../src/shared/image.js';

function jpegBuffer(padding = 32): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(padding, 0x00)]);
}

function pngBuffer(padding = 32): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(padding, 0x00),
  ]);
}

function webpBuffer(padding = 32): Buffer {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.alloc(padding, 0x00),
  ]);
}

describe('detectImageType', () => {
  it('JPEG sihirli baytlarını tanır', () => {
    expect(detectImageType(jpegBuffer())).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
  });

  it('PNG imzasını tanır', () => {
    expect(detectImageType(pngBuffer())).toEqual({ mimeType: 'image/png', extension: 'png' });
  });

  it('WebP RIFF/WEBP başlığını tanır', () => {
    expect(detectImageType(webpBuffer())).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rastgele/çok kısa içeriği reddeder', () => {
    expect(detectImageType(Buffer.from('merhaba dunya'))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.alloc(64, 0x42))).toBeNull();
  });

  it('sahte uzantılı GIF içeriğini kabul etmez', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 0x00)]);
    expect(detectImageType(gif)).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('bilinen özeti üretir', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('aynı içerik için deterministiktir', () => {
    expect(sha256Hex(Buffer.from('yaya'))).toBe(sha256Hex(Buffer.from('yaya')));
  });
});

describe('extensionForMime', () => {
  it('desteklenen türleri eşler', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });

  it('bilinmeyen tür için null döner', () => {
    expect(extensionForMime('image/gif')).toBeNull();
  });
});
