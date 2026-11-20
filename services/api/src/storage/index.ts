import type { AppEnv } from '../config/env.js';
import { LocalStorage } from './local-storage.js';
import { SupabaseStorage } from './supabase-storage.js';
import type { StorageAdapter } from './types.js';

export function createStorage(env: AppEnv): StorageAdapter {
  if (env.STORAGE_DRIVER === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'STORAGE_DRIVER=supabase için SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY zorunludur',
      );
    }

    return new SupabaseStorage({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
  }

  return new LocalStorage(env.STORAGE_LOCAL_DIR);
}

export type { StorageAdapter } from './types.js';
