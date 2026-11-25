import type { Pool } from 'pg';

import type {
  H3AnalyticsQuery,
  H3AnalyticsRepository,
  H3AreaSummary,
  H3CellFeature,
} from './analytics.types.js';

interface CellRow {
  cell: string;
  report_count: number;
  avg_score: number | null;
  pending_count: number;
  geometry: H3CellFeature['geometry'];
}

interface AreaRow {
  name: string;
  report_count: number;
}

/**
 * H3 yoğunluğunu veritabanında hesaplar.
 *
 * `reports.h3_cell` 9. çözünürlükte saklanır; istenen çözünürlük için
 * `h3_cell_to_parent` ile üst hücreye çıkılır. Sınır poligonu h3-pg'den
 * GeoJSON olarak döner, böylece panelde istemci tarafı H3 hesabı gerekmez.
 */
export class PgAnalyticsRepository implements H3AnalyticsRepository {
  constructor(private readonly pool: Pool) {}

  async h3Density(query: H3AnalyticsQuery): Promise<{
    cells: H3CellFeature[];
    totalReports: number;
    avgScore: number | null;
    topAreas: H3AreaSummary[];
  }> {
    const params = [
      query.violationType ?? null,
      query.from ?? null,
      query.to ?? null,
      query.statuses ?? null,
      query.resolution,
    ];

    const filters = `
      r.h3_cell IS NOT NULL
      AND r.status <> 'failed'
      AND ($1::violation_type IS NULL OR r.violation_type = $1::violation_type)
      AND ($2::timestamptz IS NULL OR r.captured_at >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR r.captured_at < $3::timestamptz)
      AND ($4::report_status[] IS NULL OR r.status = ANY($4::report_status[]))
    `;

    const [cellResult, areaResult, totalResult] = await Promise.all([
      this.pool.query<CellRow>(
        `WITH filtered AS (
           SELECT r.h3_cell, r.violation_type, r.confidence_score, r.status
             FROM reports r
            WHERE ${filters}
         ),
         grouped AS (
           SELECT h3_cell_to_parent(h3_cell::h3index, $5) AS parent,
                  count(*)::int AS report_count,
                  avg(confidence_score)::float8 AS avg_score,
                  count(*) FILTER (WHERE status = 'pending_review')::int AS pending_count
             FROM filtered
            GROUP BY 1
         )
         SELECT parent::bigint::text AS cell,
                report_count,
                avg_score,
                pending_count,
                ST_AsGeoJSON(h3_cell_to_boundary(parent)::geometry)::json AS geometry
           FROM grouped
          ORDER BY report_count DESC, cell ASC`,
        params,
      ),
      this.pool.query<AreaRow>(
        `SELECT COALESCE(
                  NULLIF(split_part(r.address_text, ' · ', 1), ''),
                  'Adres kaydı yok'
                ) AS name,
                count(*)::int AS report_count
           FROM reports r
          WHERE ${filters}
          GROUP BY 1
          ORDER BY report_count DESC, name ASC
          LIMIT 6`,
        params.slice(0, 4),
      ),
      this.pool.query<{ total: number; avg_score: number | null }>(
        `SELECT count(*)::int AS total, avg(r.confidence_score)::float8 AS avg_score
           FROM reports r
          WHERE ${filters}`,
        params.slice(0, 4),
      ),
    ]);

    const cells = cellResult.rows.map((row) => ({
      cell: row.cell,
      count: row.report_count,
      avgScore: row.avg_score === null ? null : Number(row.avg_score),
      pendingCount: row.pending_count,
      geometry: row.geometry,
    }));

    return {
      cells,
      totalReports: Number(totalResult.rows[0]?.total ?? 0),
      avgScore:
        totalResult.rows[0]?.avg_score === null || totalResult.rows[0]?.avg_score === undefined
          ? null
          : Number(totalResult.rows[0].avg_score),
      topAreas: areaResult.rows.map((row) => ({
        name: row.name,
        count: row.report_count,
      })),
    };
  }
}
