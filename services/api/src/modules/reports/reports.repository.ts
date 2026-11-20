import type { Pool } from 'pg';

import type {
  DecisionOutcome,
  DecisionThresholds,
  GpsSource,
  ImageDuplicateMatch,
  ListReportsQuery,
  NearDuplicateMatch,
  NewReportInput,
  PaginatedReports,
  ReportDto,
  ReportImageDto,
  ReportImageRecord,
  ReportStatus,
  ReportSummaryDto,
  ViolationType,
  ViolationTypeMeta,
} from './reports.types.js';

export interface ReportsRepository {
  findByClientReportId(clientReportId: string): Promise<ReportDto | null>;
  findById(id: string): Promise<ReportDto | null>;
  list(query: ListReportsQuery): Promise<PaginatedReports>;
  create(input: NewReportInput): Promise<ReportDto>;
  findExactImageDuplicate(sha256: Buffer): Promise<ImageDuplicateMatch | null>;
  findNearDuplicate(input: {
    violationType: ViolationType;
    latitude: number;
    longitude: number;
    capturedAt: Date;
    radiusM?: number;
    windowHours?: number;
  }): Promise<NearDuplicateMatch | null>;
  getImage(reportId: string, kind: string): Promise<ReportImageRecord | null>;
  getViolationTypes(): Promise<ViolationTypeMeta[]>;
  getThresholds(): Promise<DecisionThresholds>;
}

const REPORT_COLUMNS = `
  r.id,
  r.client_report_id,
  r.violation_type,
  r.status,
  r.decision,
  r.confidence_score,
  r.severity,
  r.description,
  r.captured_at,
  r.received_at,
  r.gps_accuracy_m,
  r.gps_source,
  r.h3_cell,
  r.h3_resolution,
  r.duplicate_of,
  r.duplicate_score,
  r.created_at,
  r.updated_at,
  ST_Y(r.location) AS latitude,
  ST_X(r.location) AS longitude,
  c.label_tr
`;

interface ReportRow {
  id: string;
  client_report_id: string;
  violation_type: ViolationType;
  status: ReportStatus;
  decision: DecisionOutcome | null;
  confidence_score: string | null;
  severity: number | null;
  description: string | null;
  captured_at: Date;
  received_at: Date;
  gps_accuracy_m: string | null;
  gps_source: GpsSource;
  h3_cell: string | null;
  h3_resolution: number;
  duplicate_of: string | null;
  duplicate_score: string | null;
  latitude: number;
  longitude: number;
  created_at: Date;
  updated_at: Date;
  label_tr: string | null;
}

interface ReportSummaryRow extends ReportRow {
  image_count: number;
}

interface ImageRow {
  id: string;
  kind: ReportImageDto['kind'];
  storage_path: string;
  mime_type: string;
  byte_size: string | null;
  width: number | null;
  height: number | null;
  sha256: Buffer;
  blur_applied: boolean;
  created_at: Date;
}

export class PgReportsRepository implements ReportsRepository {
  constructor(private readonly pool: Pool) {}

  async findByClientReportId(clientReportId: string): Promise<ReportDto | null> {
    const { rows } = await this.pool.query<ReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM reports r
         LEFT JOIN violation_type_catalog c ON c.code = r.violation_type
        WHERE r.client_report_id = $1
        LIMIT 1`,
      [clientReportId],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return this.hydrate(row);
  }

  async findById(id: string): Promise<ReportDto | null> {
    const { rows } = await this.pool.query<ReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM reports r
         LEFT JOIN violation_type_catalog c ON c.code = r.violation_type
        WHERE r.id = $1
        LIMIT 1`,
      [id],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return this.hydrate(row);
  }

  async list(query: ListReportsQuery): Promise<PaginatedReports> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      params.push(query.status);
      conditions.push(`r.status = $${params.length}::report_status`);
    }

    if (query.violationType) {
      params.push(query.violationType);
      conditions.push(`r.violation_type = $${params.length}::violation_type`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM reports r ${where}`,
      params,
    );

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;

    const { rows } = await this.pool.query<ReportSummaryRow>(
      `SELECT ${REPORT_COLUMNS},
              (SELECT count(*)::int FROM report_images i WHERE i.report_id = r.id) AS image_count
         FROM reports r
         LEFT JOIN violation_type_catalog c ON c.code = r.violation_type
         ${where}
        ORDER BY r.captured_at DESC, r.id DESC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, query.limit, query.offset],
    );

    return {
      items: rows.map((row) => this.toSummary(row)),
      total: Number(countResult.rows[0]?.total ?? 0),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async create(input: NewReportInput): Promise<ReportDto> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO reports (
            client_report_id, violation_type, captured_at, location,
            gps_accuracy_m, gps_source, description, severity,
            duplicate_of, duplicate_score, device_info
         ) VALUES (
            $1, $2::violation_type, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326),
            $6, $7, $8, $9, $10, $11, $12::jsonb
         )
         RETURNING id`,
        [
          input.clientReportId,
          input.violationType,
          input.capturedAt,
          input.longitude,
          input.latitude,
          input.accuracyM,
          input.gpsSource,
          input.description,
          input.severity,
          input.duplicateOf,
          input.duplicateScore,
          input.deviceInfo,
        ],
      );

      const reportId = rows[0]?.id;
      if (!reportId) {
        throw new Error('İhbar kaydı oluşturulamadı');
      }

      await client.query(
        `INSERT INTO report_images (
            report_id, kind, storage_path, mime_type, byte_size, sha256
         ) VALUES ($1, 'original', $2, $3, $4, $5)`,
        [reportId, input.image.storagePath, input.image.mimeType, input.image.byteSize, input.image.sha256],
      );

      await client.query('COMMIT');

      const created = await this.findById(reportId);
      if (!created) {
        throw new Error('Oluşturulan ihbar kaydı okunamadı');
      }
      return created;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async findExactImageDuplicate(sha256: Buffer): Promise<ImageDuplicateMatch | null> {
    const { rows } = await this.pool.query<{ report_id: string }>(
      `SELECT i.report_id
         FROM report_images i
        WHERE i.sha256 = $1
        ORDER BY i.created_at ASC
        LIMIT 1`,
      [sha256],
    );

    const row = rows[0];
    return row ? { reportId: row.report_id } : null;
  }

  async findNearDuplicate(input: {
    violationType: ViolationType;
    latitude: number;
    longitude: number;
    capturedAt: Date;
    radiusM?: number;
    windowHours?: number;
  }): Promise<NearDuplicateMatch | null> {
    const radiusM = input.radiusM ?? 75;
    const windowHours = input.windowHours ?? 6;

    const { rows } = await this.pool.query<{
      id: string;
      distance_m: number;
      age_seconds: number;
    }>(
      `SELECT r.id,
              ST_Distance(
                r.location::geography,
                ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
              )::float8 AS distance_m,
              EXTRACT(EPOCH FROM (r.captured_at - $4::timestamptz))::float8 AS age_seconds
         FROM reports r
        WHERE r.violation_type = $1::violation_type
          AND r.duplicate_of IS NULL
          AND r.status <> 'failed'
          AND r.captured_at BETWEEN $4::timestamptz - ($5::text || ' hours')::interval
                                AND $4::timestamptz + ($5::text || ' hours')::interval
          AND ST_DWithin(
                r.location::geography,
                ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                $6
              )
        ORDER BY r.captured_at DESC
        LIMIT 1`,
      [input.violationType, input.longitude, input.latitude, input.capturedAt, windowHours, radiusM],
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      reportId: row.id,
      distanceM: row.distance_m,
      ageSeconds: row.age_seconds,
    };
  }

  async getImage(reportId: string, kind: string): Promise<ReportImageRecord | null> {
    const { rows } = await this.pool.query<{ storage_path: string; mime_type: string }>(
      `SELECT storage_path, mime_type
         FROM report_images
        WHERE report_id = $1 AND kind = $2::media_kind
        LIMIT 1`,
      [reportId, kind],
    );

    const row = rows[0];
    return row ? { storagePath: row.storage_path, mimeType: row.mime_type } : null;
  }

  async getViolationTypes(): Promise<ViolationTypeMeta[]> {
    const { rows } = await this.pool.query<{
      code: ViolationType;
      label_tr: string;
      description: string | null;
      default_severity: number;
    }>(
      `SELECT code, label_tr, description, default_severity
         FROM violation_type_catalog
        WHERE is_active
        ORDER BY default_severity DESC, code ASC`,
    );

    return rows.map((row) => ({
      code: row.code,
      labelTr: row.label_tr,
      description: row.description,
      defaultSeverity: row.default_severity,
    }));
  }

  async getThresholds(): Promise<DecisionThresholds> {
    const { rows } = await this.pool.query<{
      value: { auto_accept?: number; manual_review?: number };
    }>(`SELECT value FROM system_setting WHERE key = 'decision.thresholds'`);

    const value = rows[0]?.value;
    return {
      autoAccept: Number(value?.auto_accept ?? 0.85),
      manualReview: Number(value?.manual_review ?? 0.6),
    };
  }

  private async hydrate(row: ReportRow): Promise<ReportDto> {
    const { rows: imageRows } = await this.pool.query<ImageRow>(
      `SELECT id, kind, storage_path, mime_type, byte_size, width, height, sha256, blur_applied, created_at
         FROM report_images
        WHERE report_id = $1
        ORDER BY created_at ASC`,
      [row.id],
    );

    return {
      ...this.toBase(row),
      images: imageRows.map(mapImage),
    };
  }

  private toSummary(row: ReportRow, imageCount = 0): ReportSummaryDto {
    return {
      ...this.toBase(row),
      imageCount,
    };
  }

  private toBase(row: ReportRow): Omit<ReportSummaryDto, 'imageCount'> {
    return {
      id: row.id,
      clientReportId: row.client_report_id,
      violationType: row.violation_type,
      violationLabel: row.label_tr,
      status: row.status,
      decision: row.decision,
      confidenceScore: row.confidence_score === null ? null : Number(row.confidence_score),
      severity: row.severity,
      description: row.description,
      capturedAt: row.captured_at.toISOString(),
      receivedAt: row.received_at.toISOString(),
      location: {
        latitude: row.latitude,
        longitude: row.longitude,
        accuracyM: row.gps_accuracy_m === null ? null : Number(row.gps_accuracy_m),
        source: row.gps_source,
      },
      h3: {
        cell: row.h3_cell,
        resolution: row.h3_resolution,
      },
      duplicateOf: row.duplicate_of,
      duplicateScore: row.duplicate_score === null ? null : Number(row.duplicate_score),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}

function mapImage(row: ImageRow): ReportImageDto {
  return {
    id: row.id,
    kind: row.kind,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    width: row.width,
    height: row.height,
    sha256: row.sha256.toString('hex'),
    blurApplied: row.blur_applied,
    createdAt: row.created_at.toISOString(),
  };
}
