import type { ReportIntegrity } from './integrity.js';
import type { ViolationType } from '../modules/reports/reports.types.js';

/**
 * Kural tabanlı yedek skor.
 *
 * AI servisi kapalıysa veya yalnızca model yüklenmemiş sezgisel hat döndürürse
 * kullanılır. Skor; ihlal türünün varsayılan ağırlığı, açıklama zenginliği,
 * EXIF doğrulaması ve mükerrerlik bilgisinden üretilir. Deterministik değildir
 * ama aynı girdi için aynı sonucu verir; böylece test edilebilir.
 */
export function heuristicScore(input: {
  violationType: ViolationType;
  severity: number | null;
  description: string | null;
  integrity: ReportIntegrity;
  duplicateOf: string | null;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const base: Record<ViolationType, number> = {
    yaya_gecidi_ihlali: 0.78,
    kaldirim_isgali: 0.72,
    sabit_engel: 0.68,
    yuzey_bozulmasi: 0.64,
    gecici_engel: 0.58,
  };

  let score = base[input.violationType];
  reasons.push(`Tür taban puanı (${input.violationType}): ${score.toFixed(2)}`);

  if (input.duplicateOf) {
    score = Math.min(score, 0.25);
    reasons.push('Mükerrer ihbar: skor 0.25 ile sınırlandı');
  }

  const descriptionLength = input.description?.trim().length ?? 0;
  if (descriptionLength >= 40) {
    score += 0.06;
    reasons.push('Açıklama ayrıntılı (+0.06)');
  } else if (descriptionLength >= 10) {
    score += 0.03;
    reasons.push('Açıklama mevcut (+0.03)');
  } else {
    score -= 0.03;
    reasons.push('Açıklama yok veya çok kısa (-0.03)');
  }

  if (input.severity !== null) {
    const adjustment = (input.severity - 3) * 0.03;
    score += adjustment;
    reasons.push(`Bildirilen şiddet ${input.severity} (${adjustment >= 0 ? '+' : ''}${adjustment.toFixed(2)})`);
  }

  const gps = input.integrity.checks.gps.status;
  const time = input.integrity.checks.capturedAt.status;

  if (gps === 'match') {
    score += 0.05;
    reasons.push('EXIF GPS konumu doğrulandı (+0.05)');
  } else if (gps === 'mismatch') {
    score -= 0.12;
    reasons.push('EXIF GPS konumu uyuşmuyor (-0.12)');
  }

  if (time === 'match') {
    score += 0.03;
    reasons.push('EXIF zamanı doğrulandı (+0.03)');
  } else if (time === 'mismatch') {
    score -= 0.08;
    reasons.push('EXIF zamanı uyuşmuyor (-0.08)');
  }

  if (input.integrity.anonymization.status === 'applied') {
    score += 0.01;
    reasons.push('KVKK anonimleştirmesi uygulandı (+0.01)');
  }

  // Mükerrer kayıt her koşulda otomatik redd bandında kalmalı.
  if (input.duplicateOf) {
    score = Math.min(score, 0.25);
  }

  return {
    score: Math.round(Math.min(0.97, Math.max(0.05, score)) * 1000) / 1000,
    reasons,
  };
}
