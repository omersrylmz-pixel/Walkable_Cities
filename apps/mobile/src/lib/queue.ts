import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, postReport } from './api';
import { deletePreparedImage } from './media';
import type { QueueItem } from './types';

const STORAGE_KEY = 'yaya.report.queue.v1';
const MAX_AUTO_ATTEMPTS = 8;

export interface FlushSummary {
  uploaded: number;
  pending: number;
  failed: number;
  skipped: number;
}

export interface QueueStats {
  total: number;
  pending: number;
  uploading: number;
  failed: number;
}

/** Kuyruk ekranındaki rozetler için durum dağılımını hesaplar. */
export function summarizeQueue(items: readonly QueueItem[]): QueueStats {
  const stats: QueueStats = { total: items.length, pending: 0, uploading: 0, failed: 0 };
  for (const item of items) {
    stats[item.status] += 1;
  }
  return stats;
}

type Listener = () => void;

const listeners = new Set<Listener>();

/** Kuyruk değiştiğinde abone ekranları bilgilendirir. */
export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export async function loadQueue(): Promise<QueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Yeni ihbarı kuyruğa ekler. Aynı `clientReportId` zaten varsa
 * (çift dokunuş) mevcut kayıt korunur.
 */
export async function enqueue(item: QueueItem): Promise<void> {
  const items = await loadQueue();
  if (items.some((existing) => existing.clientReportId === item.clientReportId)) {
    return;
  }

  await persist([item, ...items]);
}

export async function updateItem(
  clientReportId: string,
  patch: Partial<Omit<QueueItem, 'clientReportId'>>,
): Promise<QueueItem | null> {
  const items = await loadQueue();
  const index = items.findIndex((item) => item.clientReportId === clientReportId);
  if (index === -1) {
    return null;
  }

  const current = items[index];
  if (!current) {
    return null;
  }

  const updated: QueueItem = { ...current, ...patch };
  const next = [...items];
  next[index] = updated;
  await persist(next);
  return updated;
}

export async function removeItem(clientReportId: string): Promise<void> {
  const items = await loadQueue();
  const target = items.find((item) => item.clientReportId === clientReportId);
  if (!target) {
    return;
  }

  await persist(items.filter((item) => item.clientReportId !== clientReportId));
  deletePreparedImage(target.imageUri);
}

/** Kalıcı hatadan sonra kullanıcı "tekrar dene" dediğinde sayaçları sıfırlar. */
export async function retryItem(clientReportId: string): Promise<void> {
  await updateItem(clientReportId, {
    status: 'pending',
    retryable: true,
    attempts: 0,
    lastError: null,
  });
}

/**
 * Otomatik deneme hakkı dolmuş tüm kayıtları yeniden denenebilir yapar.
 * Tek tek "tekrar dene"ye basmaya gerek kalmadan toplu kurtarma sağlar.
 * Etkilenen kayıt sayısını döndürür.
 */
export async function retryFailedItems(): Promise<number> {
  const items = await loadQueue();
  let touched = 0;

  const next = items.map((item) => {
    if (item.status !== 'failed') {
      return item;
    }
    touched += 1;
    return { ...item, status: 'pending' as const, retryable: true, attempts: 0, lastError: null };
  });

  if (touched > 0) {
    await persist(next);
  }

  return touched;
}

export async function clearQueue(): Promise<void> {
  const items = await loadQueue();
  await persist([]);
  for (const item of items) {
    deletePreparedImage(item.imageUri);
  }
}

let activeFlush: Promise<FlushSummary> | null = null;

/**
 * Kuyruğu sırayla gönderir. Aynı anda birden fazla çağrı yapılırsa
 * mevcut çalışan gönderim paylaşılır; çift yükleme olmaz.
 */
export function flushQueue(): Promise<FlushSummary> {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = runFlush().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

async function runFlush(): Promise<FlushSummary> {
  const summary: FlushSummary = { uploaded: 0, pending: 0, failed: 0, skipped: 0 };
  const snapshot = await loadQueue();

  for (const snapshotItem of snapshot) {
    // Kayıt bu sırada silinmiş veya değişmiş olabilir; güncel hâlini oku.
    const current = (await loadQueue()).find(
      (item) => item.clientReportId === snapshotItem.clientReportId,
    );

    if (!current) {
      continue;
    }

    if (current.status === 'failed' && !current.retryable) {
      summary.skipped += 1;
      continue;
    }

    await updateItem(current.clientReportId, { status: 'uploading', lastError: null });

    try {
      await postReport(current);
      await removeItem(current.clientReportId);
      summary.uploaded += 1;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const attempts = current.attempts + 1;
      const retryable =
        (apiError ? apiError.retryable : true) && attempts < MAX_AUTO_ATTEMPTS;
      const message = error instanceof Error ? error.message : 'Bilinmeyen hata';

      await updateItem(current.clientReportId, {
        status: retryable ? 'pending' : 'failed',
        retryable,
        attempts,
        lastError: message,
      });

      if (retryable) {
        summary.pending += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

function normalize(raw: unknown): QueueItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(isQueueItem).map((item) =>
    // Uygulama gönderim sırasında kapandıysa "uploading" durumu takılı kalır.
    item.status === 'uploading' ? { ...item, status: 'pending' } : item,
  );
}

function isQueueItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Partial<QueueItem>;
  return (
    typeof item.clientReportId === 'string' &&
    typeof item.violationType === 'string' &&
    typeof item.capturedAt === 'string' &&
    typeof item.imageUri === 'string' &&
    typeof item.latitude === 'number' &&
    typeof item.longitude === 'number'
  );
}

async function persist(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  emit();
}
