import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useQueue } from '@/hooks/useQueue';
import { measureClockDriftSeconds } from '@/lib/api';
import {
  CLOCK_DRIFT_WARN_SECONDS,
  HARD_GPS_ACCURACY_M,
  TARGET_GPS_ACCURACY_M,
} from '@/lib/config';
import { formatAccuracy } from '@/lib/format';
import { acquireFix, LocationError, requestLocationAccess } from '@/lib/location';
import { prepareImage } from '@/lib/media';
import { enqueue, flushQueue } from '@/lib/queue';
import {
  VIOLATION_TYPES,
  type GeoFix,
  type QueueItem,
  type ViolationType,
} from '@/lib/types';

type MessageTone = 'ok' | 'warn' | 'error';

interface Message {
  tone: MessageTone;
  text: string;
}

export default function CaptureScreen() {
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const { items } = useQueue();

  const [violationType, setViolationType] = useState<ViolationType>('kaldirim_isgali');
  const [description, setDescription] = useState('');
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [drift, setDrift] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const granted = await requestLocationAccess();
      if (!granted) {
        if (active) {
          setMessage({ tone: 'error', text: 'Konum izni verilmedi; ihbar gönderilemez.' });
        }
        return;
      }

      if (active) {
        setLocating(true);
      }

      try {
        const nextFix = await acquireFix({ targetAccuracyM: TARGET_GPS_ACCURACY_M });
        if (active) {
          setFix(nextFix);
        }
      } catch (error) {
        if (active) {
          setMessage({
            tone: 'error',
            text: error instanceof LocationError ? error.message : 'Konum alınamadı.',
          });
        }
      } finally {
        if (active) {
          setLocating(false);
        }
      }
    })();

    void measureClockDriftSeconds().then((value) => {
      if (active) {
        setDrift(value);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const refreshLocation = useCallback(async () => {
    setLocating(true);
    try {
      const nextFix = await acquireFix({ targetAccuracyM: TARGET_GPS_ACCURACY_M });
      setFix(nextFix);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof LocationError ? error.message : 'Konum alınamadı.',
      });
    } finally {
      setLocating(false);
    }
  }, []);

  const capture = useCallback(async () => {
    if (busy || !cameraRef.current) {
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      // 1) Konum: hedef doğruluğa ulaşmayı dene, sert sınırı aşarsa durdur.
      let currentFix = fix;
      if (!currentFix || currentFix.accuracyM > TARGET_GPS_ACCURACY_M) {
        setLocating(true);
        try {
          currentFix = await acquireFix({ targetAccuracyM: TARGET_GPS_ACCURACY_M });
          setFix(currentFix);
        } finally {
          setLocating(false);
        }
      }

      if (currentFix.accuracyM > HARD_GPS_ACCURACY_M) {
        setMessage({
          tone: 'error',
          text: `Konum doğruluğu yetersiz (${formatAccuracy(
            currentFix.accuracyM,
          )}). Açık alanda tekrar deneyin.`,
        });
        return;
      }

      // 2) Saat farkı: cihaz saati sunucudan fazla ileriyse gönderim reddedilir.
      const currentDrift = drift ?? (await measureClockDriftSeconds());
      setDrift(currentDrift);

      if (currentDrift !== null && currentDrift < -CLOCK_DRIFT_WARN_SECONDS * 2) {
        setMessage({
          tone: 'error',
          text: `Cihaz saati sunucudan ${Math.abs(currentDrift)} sn ileride. Lütfen saat ayarlarını düzeltin.`,
        });
        return;
      }

      // 3) Çekim
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });

      if (!photo) {
        throw new Error('Fotoğraf çekilemedi');
      }

      // 4) Görseli küçült, JPEG'e çevir ve kalıcı kuyruk dizinine kopyala.
      const clientReportId = Crypto.randomUUID();
      const prepared = await prepareImage(photo.uri, clientReportId, photo.width);
      const capturedAt = new Date().toISOString();

      const item: QueueItem = {
        clientReportId,
        violationType,
        capturedAt,
        createdAt: capturedAt,
        latitude: currentFix.latitude,
        longitude: currentFix.longitude,
        accuracyM: currentFix.accuracyM,
        clockDriftSeconds: currentDrift,
        description: description.trim().length > 0 ? description.trim() : null,
        imageUri: prepared.uri,
        imageWidth: prepared.width,
        imageHeight: prepared.height,
        mimeType: 'image/jpeg',
        status: 'pending',
        retryable: true,
        attempts: 0,
        lastError: null,
      };

      await enqueue(item);
      setDescription('');

      const summary = await flushQueue();

      if (summary.uploaded > 0) {
        setMessage({ tone: 'ok', text: 'İhbar başarıyla gönderildi.' });
      } else if (summary.failed > 0) {
        setMessage({
          tone: 'error',
          text: 'Sunucu ihbarı reddetti. Kuyruktan ayrıntıya bakabilirsiniz.',
        });
      } else {
        setMessage({
          tone: 'warn',
          text: 'Çevrimdışısınız veya sunucuya ulaşılamadı; ihbar kuyruğa alındı.',
        });
      }
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu.',
      });
    } finally {
      setBusy(false);
    }
  }, [busy, description, drift, fix, violationType]);

  const gpsTone: MessageTone =
    fix === null ? 'warn' : fix.accuracyM <= TARGET_GPS_ACCURACY_M ? 'ok' : 'warn';
  const driftTone: MessageTone =
    drift === null || Math.abs(drift) <= CLOCK_DRIFT_WARN_SECONDS ? 'ok' : 'warn';

  return (
    <View style={styles.root}>
      <View style={styles.cameraArea}>
        {permission?.granted ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={styles.permissionBox}>
            <Text style={styles.permissionTitle}>Kamera izni gerekli</Text>
            <Text style={styles.permissionText}>
              İhbar fotoğrafı yalnızca canlı kamera ile çekilebilir. Galeriden yükleme desteklenmez.
            </Text>
            <Pressable
              style={styles.permissionButton}
              onPress={() => void requestPermission()}
            >
              <Text style={styles.permissionButtonText}>Kamera izni ver</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.statusRow} pointerEvents="none">
          <StatusPill
            label={locating ? 'GPS aranıyor…' : `GPS ${formatAccuracy(fix?.accuracyM)}`}
            tone={gpsTone}
          />
          <StatusPill
            label={
              drift === null
                ? 'Saat: —'
                : `Saat ${drift > 0 ? '+' : ''}${drift} sn`
            }
            tone={driftTone}
          />
        </View>

        {message && (
          <View style={[styles.banner, styles[`banner_${message.tone}`]]}>
            <Text style={styles.bannerText}>{message.text}</Text>
          </View>
        )}

        {busy && (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="large" color="#f8fafc" />
            <Text style={styles.busyText}>İhbar hazırlanıyor…</Text>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {VIOLATION_TYPES.map((type) => {
            const selected = type.code === violationType;
            return (
              <Pressable
                key={type.code}
                onPress={() => setViolationType(type.code)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {type.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Kısa açıklama (isteğe bağlı)"
          placeholderTextColor="#64748b"
          maxLength={500}
          style={styles.input}
        />

        <View style={styles.actions}>
          <Pressable
            onPress={() => void capture()}
            disabled={busy || !permission?.granted}
            style={[styles.captureButton, (busy || !permission?.granted) && styles.captureDisabled]}
          >
            <Text style={styles.captureText}>
              {busy ? 'Gönderiliyor…' : 'Fotoğraf Çek ve Gönder'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.push('/queue')}
            style={styles.queueButton}
          >
            <Text style={styles.queueText}>
              Kuyruk{items.length > 0 ? ` (${items.length})` : ''}
            </Text>
          </Pressable>
        </View>

        <View style={styles.hintRow}>
          <Pressable onPress={() => void refreshLocation()} disabled={locating}>
            <Text style={styles.link}>Konumu yenile</Text>
          </Pressable>
          <Text style={styles.hint}>
            Galeri kapalı · GPS hedefi ≤ {TARGET_GPS_ACCURACY_M} m
          </Text>
        </View>
      </View>
    </View>
  );
}

function StatusPill({ label, tone }: { label: string; tone: MessageTone }) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  cameraArea: {
    flex: 1,
    minHeight: 320,
    backgroundColor: '#020617',
    overflow: 'hidden',
  },
  permissionBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  permissionTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '700',
  },
  permissionText: {
    color: '#cbd5e1',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  permissionButton: {
    marginTop: 8,
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
  },
  permissionButtonText: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  statusRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pill_ok: {
    backgroundColor: 'rgba(22, 163, 74, 0.9)',
  },
  pill_warn: {
    backgroundColor: 'rgba(202, 138, 4, 0.92)',
  },
  pill_error: {
    backgroundColor: 'rgba(185, 28, 28, 0.92)',
  },
  pillText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 12,
    padding: 12,
  },
  banner_ok: {
    backgroundColor: 'rgba(22, 163, 74, 0.95)',
  },
  banner_warn: {
    backgroundColor: 'rgba(202, 138, 4, 0.95)',
  },
  banner_error: {
    backgroundColor: 'rgba(185, 28, 28, 0.95)',
  },
  bannerText: {
    color: '#f8fafc',
    fontSize: 13,
    lineHeight: 18,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  busyText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  panel: {
    backgroundColor: '#0b1220',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 12,
  },
  chipRow: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  chipTextSelected: {
    color: '#f8fafc',
    fontWeight: '700',
  },
  input: {
    backgroundColor: '#111c33',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    color: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  captureButton: {
    flex: 1,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  captureDisabled: {
    opacity: 0.55,
  },
  captureText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
  },
  queueButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  queueText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
  hintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  link: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '600',
  },
  hint: {
    color: '#64748b',
    fontSize: 11,
    flexShrink: 1,
    textAlign: 'right',
  },
});
