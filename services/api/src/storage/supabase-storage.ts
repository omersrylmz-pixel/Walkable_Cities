import { AppError } from '../shared/errors.js';
import type { PutObjectInput, StorageAdapter, StoredObject, StoredObjectData } from './types.js';

export interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

/**
 * Supabase Storage REST API üzerinden çalışan adaptör.
 * Ek SDK bağımlılığı eklememek için doğrudan `fetch` kullanır.
 *
 * Not: Service role anahtarı yalnızca sunucuda tutulur; istemciye sızdırılmaz.
 */
export class SupabaseStorage implements StorageAdapter {
  readonly driver = 'supabase' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: SupabaseStorageConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const response = await this.request(
      'PUT',
      `/storage/v1/object/${encodeURIComponent(this.config.bucket)}/${encodeKey(input.key)}`,
      {
        body: input.body,
        headers: {
          'content-type': input.contentType,
          'x-upsert': 'false',
        },
      },
    );

    if (!response.ok) {
      await this.fail(response, 'Görsel Supabase Storage\'a yüklenemedi');
    }

    return {
      key: input.key,
      byteSize: input.body.byteLength,
      contentType: input.contentType,
    };
  }

  async get(key: string): Promise<StoredObjectData> {
    const response = await this.request(
      'GET',
      `/storage/v1/object/authenticated/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`,
    );

    if (response.status === 404) {
      throw new AppError(404, 'NOT_FOUND', 'Görsel bulunamadı');
    }
    if (!response.ok) {
      await this.fail(response, 'Görsel Supabase Storage\'dan okunamadı');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      body: buffer,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const response = await this.request(
      'DELETE',
      `/storage/v1/object/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`,
    );

    // 404 zaten silinmiş demektir; idempotent davran.
    if (!response.ok && response.status !== 404) {
      await this.fail(response, 'Görsel Supabase Storage\'dan silinemedi');
    }
  }

  private request(
    method: string,
    path: string,
    options: { body?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      body: options.body,
      headers: {
        apikey: this.config.serviceRoleKey,
        authorization: `Bearer ${this.config.serviceRoleKey}`,
        ...options.headers,
      },
    });
  }

  private async fail(response: Response, message: string): Promise<never> {
    const detail = await response.text().catch(() => '');
    throw new AppError(
      502,
      'STORAGE_ERROR',
      `${message} (HTTP ${response.status})`,
      detail ? [{ path: 'storage', message: detail.slice(0, 300) }] : undefined,
    );
  }
}

/** Her yol parçasını ayrı ayrı kodlar; `/` korunur. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
