import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useQueue } from '@/hooks/useQueue';
import { formatAccuracy, formatDateTime } from '@/lib/format';
import { flushQueue, removeItem, retryItem } from '@/lib/queue';
import { violationLabel, type QueueItem, type QueueStatus } from '@/lib/types';

const STATUS_LABEL: Record<QueueStatus, string> = {
  pending: 'Bekliyor',
  uploading: 'Gönderiliyor',
  failed: 'Hata',
};

export default function QueueScreen() {
  const { items, loading } = useQueue();
  const [flushing, setFlushing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const sendAll = useCallback(async () => {
    if (flushing) {
      return;
    }

    setFlushing(true);
    setSummary(null);
    try {
      const result = await flushQueue();
      setSummary(
        `Gönderildi: ${result.uploaded} · Bekleyen: ${result.pending} · Hatalı: ${result.failed}` +
          (result.skipped > 0 ? ` · Atlanan: ${result.skipped}` : ''),
      );
    } finally {
      setFlushing(false);
    }
  }, [flushing]);

  const confirmDelete = useCallback((item: QueueItem) => {
    const remove = (): void => {
      void removeItem(item.clientReportId);
    };

    if (Platform.OS === 'web') {
      remove();
      return;
    }

    Alert.alert('İhbarı sil', 'Bu kayıt ve görseli cihazdan kalıcı olarak silinsin mi?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: remove },
    ]);
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#60a5fa" />
        <Text style={styles.muted}>Kuyruk okunuyor…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          {items.length === 0
            ? 'Bekleyen ihbar yok.'
            : `${items.length} kayıt cihazda saklanıyor.`}
        </Text>
        <Pressable
          onPress={() => void sendAll()}
          disabled={flushing || items.length === 0}
          style={[styles.sendButton, (flushing || items.length === 0) && styles.disabled]}
        >
          <Text style={styles.sendText}>{flushing ? 'Gönderiliyor…' : 'Tümünü Gönder'}</Text>
        </Pressable>
      </View>

      {summary && <Text style={styles.summary}>{summary}</Text>}

      <FlatList
        data={items}
        keyExtractor={(item) => item.clientReportId}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Kuyruk boş</Text>
            <Text style={styles.muted}>
              Çevrimdışıyken çekilen ihbarlar burada birikir ve bağlantı gelince otomatik gönderilir.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{violationLabel(item.violationType)}</Text>
              <View style={[styles.badge, styles[`badge_${item.status}`]]}>
                <Text style={styles.badgeText}>{STATUS_LABEL[item.status]}</Text>
              </View>
            </View>

            <Text style={styles.meta}>
              {formatDateTime(item.capturedAt)} · GPS {formatAccuracy(item.accuracyM)}
            </Text>

            {item.description ? <Text style={styles.description}>{item.description}</Text> : null}

            {item.attempts > 0 && (
              <Text style={styles.attempts}>Deneme: {item.attempts}</Text>
            )}

            {item.lastError ? (
              <Text style={styles.error} numberOfLines={3}>
                {item.lastError}
              </Text>
            ) : null}

            <View style={styles.cardActions}>
              {item.status !== 'uploading' && (
                <Pressable
                  onPress={() => {
                    void retryItem(item.clientReportId).then(() => void sendAll());
                  }}
                  style={styles.smallButton}
                >
                  <Text style={styles.smallButtonText}>Tekrar dene</Text>
                </Pressable>
              )}
              <Pressable onPress={() => confirmDelete(item)} style={styles.deleteButton}>
                <Text style={styles.deleteText}>Sil</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#0b1220',
  },
  header: {
    padding: 16,
    gap: 12,
  },
  headerText: {
    color: '#e2e8f0',
    fontSize: 14,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  sendText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 14,
  },
  summary: {
    color: '#93c5fd',
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontSize: 12,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  emptyBox: {
    marginTop: 48,
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  muted: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  card: {
    backgroundColor: '#111c33',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badge_pending: {
    backgroundColor: 'rgba(202, 138, 4, 0.25)',
  },
  badge_uploading: {
    backgroundColor: 'rgba(37, 99, 235, 0.28)',
  },
  badge_failed: {
    backgroundColor: 'rgba(185, 28, 28, 0.28)',
  },
  badgeText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  description: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
  },
  attempts: {
    color: '#fbbf24',
    fontSize: 11,
  },
  error: {
    color: '#fca5a5',
    fontSize: 12,
    lineHeight: 17,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  smallButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
  },
});
