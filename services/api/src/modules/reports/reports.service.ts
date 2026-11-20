import { randomUUID } from 'node:crypto';

import {
  notFound,
  payloadTooLarge,
  unprocessable,
  unsupportedMedia,
} from '../../shared/errors.js';
import { detectImageType, sha256Buffer } from '../../shared/image.js';
import type { StorageAdapter, StoredObjectData } from '../../storage/types.js';
import type { ReportsRepository } from './reports.repository.js';
import { parseReportMetadata } from './reports.schemas.js';
import type {
  CreateReportOutcome,
  ListReportsQuery,
  PaginatedReports,
  ReportDto,
  ReportImageRecord,
} from './reports.types.js';

export interface CreateReportInput {
  metadata: unknown;
  image: {
    buffer: Buffer;
    declaredMimeType: string;
  };
}

export interface ReportsServiceDeps {
  repository: ReportsRepository;
  storage: StorageAdapter;
  maxUploadBytes: number;
  now?: () => Date;
}

/** Yakın mükerrer eşiği: bu skorun altındaki benzerlikler mükerrer sayılmaz. */
export const NEAR_DUPLICATE_THRESHOLD = 0.7;

const NEAR_DUPLICATE_RADIUS_M = 75;
const NEAR_DUPLICATE_WINDOW_HOURS = 6;

/**
 * Mesafe ve zaman yakınlığından 0–1 arası mükerrerlik skoru üretir.
 * Ağırlık: %60 konum, %40 zaman.
 */
export function nearDuplicateScore(
  distanceM: number,
  ageSeconds: number,
  radiusM = NEAR_DUPLICATE_RADIUS_M,
  windowHours = NEAR_DUPLICATE_WINDOW_HOURS,
): number {
  const safeDistance = Math.min(Math.max(distanceM, 0), radiusM);
  const safeAge = Math.min(Math.abs(ageSeconds), windowHours * 3600);

  const distanceFactor = 1 - safeDistance / radiusM;
  const ageFactor = 1 - safeAge / (windowHours * 3600);

  return Math.round((0.6 * distanceFactor + 0.4 * ageFactor) * 1000) / 1000;
}

export class ReportsService {
  private readonly now: () => Date;

  constructor(private readonly deps: ReportsServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async createReport(input: CreateReportInput): Promise<CreateReportOutcome> {
    const metadata = parseReportMetadata(input.metadata, this.now());

    // 1) Idempotency: aynı clientReportId daha önce işlendiyse mevcut kaydı döndür.
    const existing = await this.deps.repository.findByClientReportId(metadata.clientReportId);
    if (existing) {
      return { report: existing, replayed: true };
    }

    // 2) Görsel doğrulama (boyut + gerçek tür + SHA-256)
    if (input.image.buffer.byteLength === 0) {
      throw unprocessable('Görsel dosyası boş olamaz');
    }
    if (input.image.buffer.byteLength > this.deps.maxUploadBytes) {
      throw payloadTooLarge(
        `Görsel boyutu en fazla ${Math.round(this.deps.maxUploadBytes / (1024 * 1024))} MB olabilir`,
      );
    }

    const detected = detectImageType(input.image.buffer);
    if (!detected) {
      throw unsupportedMedia('Yalnızca JPEG, PNG veya WebP görseller kabul edilir');
    }

    const declared = input.image.declaredMimeType.toLowerCase();
    const declaredMatches =
      declared === detected.mimeType ||
      (declared === 'image/jpg' && detected.mimeType === 'image/jpeg') ||
      declared === 'application/octet-stream';

    if (!declaredMatches) {
      throw unsupportedMedia(
        `Bildirilen içerik türü (${input.image.declaredMimeType}) ile dosya içeriği uyuşmuyor`,
      );
    }

    const sha256 = sha256Buffer(input.image.buffer);
    const capturedAt = new Date(metadata.capturedAt);

    // 3) Mükerrer kontrolü: önce birebir aynı görsel, sonra konum+zaman yakınlığı.
    let duplicateOf: string | null = null;
    let duplicateScore: number | null = null;

    const exact = await this.deps.repository.findExactImageDuplicate(sha256);
    if (exact) {
      duplicateOf = exact.reportId;
      duplicateScore = 1;
    } else {
      const near = await this.deps.repository.findNearDuplicate({
        violationType: metadata.violationType,
        latitude: metadata.location.latitude,
        longitude: metadata.location.longitude,
        capturedAt,
        radiusM: NEAR_DUPLICATE_RADIUS_M,
        windowHours: NEAR_DUPLICATE_WINDOW_HOURS,
      });

      if (near) {
        const score = nearDuplicateScore(near.distanceM, near.ageSeconds);
        if (score >= NEAR_DUPLICATE_THRESHOLD) {
          duplicateOf = near.reportId;
          duplicateScore = score;
        }
      }
    }

    // 4) Görseli depola; DB yazımı başarısız olursa geri al (compensation).
    const storageKey = buildStorageKey(capturedAt, detected.extension);
    const stored = await this.deps.storage.put({
      key: storageKey,
      body: input.image.buffer,
      contentType: detected.mimeType,
    });

    try {
      const report = await this.deps.repository.create({
        clientReportId: metadata.clientReportId,
        violationType: metadata.violationType,
        capturedAt,
        latitude: metadata.location.latitude,
        longitude: metadata.location.longitude,
        accuracyM: metadata.location.accuracyM ?? null,
        gpsSource: metadata.location.source,
        description: metadata.description ?? null,
        severity: metadata.severity ?? null,
        deviceInfo: {
          platform: metadata.device.platform,
          osVersion: metadata.device.osVersion ?? null,
          appVersion: metadata.device.appVersion ?? null,
          clockDriftSeconds: metadata.device.clockDriftSeconds ?? null,
        },
        duplicateOf,
        duplicateScore,
        image: {
          storagePath: stored.key,
          sha256,
          mimeType: detected.mimeType,
          byteSize: stored.byteSize,
        },
      });

      return { report, replayed: false };
    } catch (error) {
      await this.deps.storage.delete(stored.key).catch(() => undefined);

      // Eşzamanlı iki istek aynı clientReportId ile geldiyse unique ihlali oluşur.
      if (isUniqueViolation(error)) {
        const raced = await this.deps.repository.findByClientReportId(metadata.clientReportId);
        if (raced) {
          return { report: raced, replayed: true };
        }
      }

      throw error;
    }
  }

  async getReport(id: string): Promise<ReportDto> {
    const report = await this.deps.repository.findById(id);
    if (!report) {
      throw notFound('İhbar bulunamadı');
    }
    return report;
  }

  async listReports(query: ListReportsQuery): Promise<PaginatedReports> {
    return this.deps.repository.list(query);
  }

  async getImage(
    reportId: string,
    kind: string,
  ): Promise<{ record: ReportImageRecord; data: StoredObjectData }> {
    const record = await this.deps.repository.getImage(reportId, kind);
    if (!record) {
      throw notFound('Görsel bulunamadı');
    }

    const data = await this.deps.storage.get(record.storagePath);
    return { record, data };
  }

  async getMeta(): Promise<{
    violationTypes: Awaited<ReturnType<ReportsRepository['getViolationTypes']>>;
    thresholds: Awaited<ReturnType<ReportsRepository['getThresholds']>>;
  }> {
    const [violationTypes, thresholds] = await Promise.all([
      this.deps.repository.getViolationTypes(),
      this.deps.repository.getThresholds(),
    ]);

    return { violationTypes, thresholds };
  }
}

function buildStorageKey(capturedAt: Date, extension: string): string {
  const year = capturedAt.getUTCFullYear();
  const month = String(capturedAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(capturedAt.getUTCDate()).padStart(2, '0');
  return `reports/${year}/${month}/${day}/${randomUUID()}.${extension}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}
