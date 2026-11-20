export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  key: string;
  byteSize: number;
  contentType: string;
}

export interface StoredObjectData {
  body: Buffer;
  contentType: string;
}

/**
 * Görsel depolama soyutlaması. Faz 1'de `local`, üretimde `supabase`
 * (Supabase Storage / S3 uyumlu) kullanılabilir.
 */
export interface StorageAdapter {
  readonly driver: 'local' | 'supabase';
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<StoredObjectData>;
  delete(key: string): Promise<void>;
}
