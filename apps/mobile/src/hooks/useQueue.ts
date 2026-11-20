import { useEffect, useState } from 'react';

import { loadQueue, subscribeQueue } from '@/lib/queue';
import type { QueueItem } from '@/lib/types';

/** Kuyruğu yükler ve değişikliklerde otomatik yeniler. */
export function useQueue(): { items: QueueItem[]; loading: boolean } {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const refresh = (): void => {
      void loadQueue().then((next) => {
        if (active) {
          setItems(next);
          setLoading(false);
        }
      });
    };

    refresh();
    const unsubscribe = subscribeQueue(refresh);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { items, loading };
}
