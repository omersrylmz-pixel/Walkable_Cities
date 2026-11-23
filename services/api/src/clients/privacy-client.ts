/** KVKK anonimleştirme istemcisi: AI servisinin `/v1/anonymize` ucunu çağırır. */

export interface AnonymizeInput {
  buffer: Buffer;
  mimeType: string;
  requestId?: string;
}

export interface AnonymizedImage {
  body: Buffer;
  mimeType: 'image/png';
  backend: string | null;
  facesBlurred: number;
  platesBlurred: number;
  width: number | null;
  height: number | null;
}

/** Testlerde sahte anonimleştirici enjekte etmek için sözleşme. */
export interface Anonymizer {
  anonymize(input: AnonymizeInput): Promise<AnonymizedImage>;
}

export class PrivacyClientError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = 'PrivacyClientError';
  }
}

const ANONYMIZE_PATH = '/v1/anonymize';

export class PrivacyClient implements Anonymizer {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async anonymize(input: AnonymizeInput): Promise<AnonymizedImage> {
    const form = new FormData();
    form.append(
      'image',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
      'upload',
    );

    let response: Response;
    try {
      response = await fetch(new URL(ANONYMIZE_PATH, this.baseUrl), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: input.requestId ? { 'x-request-id': input.requestId } : undefined,
      });
    } catch (error) {
      throw new PrivacyClientError(
        `Anonimleştirme servisine ulaşılamadı: ${errorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new PrivacyClientError(
        `Anonimleştirme başarısız (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        response.status,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim();
    if (contentType !== 'image/png') {
      throw new PrivacyClientError(`Beklenmeyen yanıt türü: ${contentType || '(boş)'}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength === 0) {
      throw new PrivacyClientError('Anonimleştirme servisi boş görsel döndürdü');
    }

    return {
      body,
      mimeType: 'image/png',
      backend: asHeaderText(response.headers.get('x-anonymizer-backend')),
      facesBlurred: parseCount(response.headers.get('x-faces-blurred')),
      platesBlurred: parseCount(response.headers.get('x-plates-blurred')),
      width: parseOptionalNumber(response.headers.get('x-image-width')),
      height: parseOptionalNumber(response.headers.get('x-image-height')),
    };
  }
}

function parseCount(value: string | null): number {
  const parsed = parseOptionalNumber(value);
  return parsed !== null && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function parseOptionalNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asHeaderText(value: string | null): string | null {
  return value !== null && value.trim() !== '' ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
