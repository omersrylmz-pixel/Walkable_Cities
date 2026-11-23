import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrivacyClient, PrivacyClientError } from '../src/clients/privacy-client.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function okResponse(headers: Record<string, string> = {}): Response {
  return new Response(PNG_BYTES, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'x-anonymizer-backend': 'heuristic',
      'x-faces-blurred': '2',
      'x-plates-blurred': '1',
      'x-image-width': '640',
      'x-image-height': '480',
      ...headers,
    },
  });
}

function client() {
  return new PrivacyClient('http://ai-service:8000', 5_000);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PrivacyClient', () => {
  it('görseli multipart olarak gönderip sonucu ve başlıkları ayrıştırır', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await client().anonymize({
      buffer: Buffer.from('jpeg-bytes'),
      mimeType: 'image/jpeg',
      requestId: 'req-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://ai-service:8000/v1/anonymize');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)['x-request-id']).toBe('req-1');

    expect(result).toEqual({
      body: PNG_BYTES,
      mimeType: 'image/png',
      backend: 'heuristic',
      facesBlurred: 2,
      platesBlurred: 1,
      width: 640,
      height: 480,
    });
  });

  it('eksik veya bozuk başlıklarda güvenli varsayılan kullanır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        okResponse({
          'x-faces-blurred': 'abc',
          'x-plates-blurred': '-3',
          'x-image-width': '',
          'x-image-height': 'NaN',
          'x-anonymizer-backend': '',
        }),
      ),
    );

    const result = await client().anonymize({ buffer: PNG_BYTES, mimeType: 'image/png' });

    expect(result.facesBlurred).toBe(0);
    expect(result.platesBlurred).toBe(0);
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
    expect(result.backend).toBeNull();
  });

  it('HTTP hatasını durum koduyla birlikte fırlatır', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"detail":"model yok"}', {
            status: 503,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ),
    );

    const error = await client()
      .anonymize({ buffer: PNG_BYTES, mimeType: 'image/png' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrivacyClientError);
    expect(error).toMatchObject({ statusCode: 503 });
    expect((error as Error).message).toContain('model yok');
  });

  it('beklenmeyen içerik türünü reddeder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not png', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(
      client().anonymize({ buffer: PNG_BYTES, mimeType: 'image/png' }),
    ).rejects.toThrow(/Beklenmeyen yanıt türü/);
  });

  it('boş yanıt gövdesini reddeder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })),
    );

    await expect(
      client().anonymize({ buffer: PNG_BYTES, mimeType: 'image/png' }),
    ).rejects.toThrow(/boş görsel/);
  });

  it('ağ hatasını anlaşılır mesaja çevirir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    await expect(
      client().anonymize({ buffer: PNG_BYTES, mimeType: 'image/png' }),
    ).rejects.toThrow(/ulaşılamadı.*ECONNREFUSED/);
  });
});
