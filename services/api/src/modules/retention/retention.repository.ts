import type { Pool } from 'pg';

export interface ExpiredImage {
  id: string;
  storagePath: string;
}

export interface RetentionRepository {
  /** Saklama süresi dolmuş görselleri en eski kayıttan başlayarak listeler. */
  findExpiredImages(now: Date, limit: number): Promise<ExpiredImage[]>;
  /** Tek görsel kaydını siler. Depolama temizliği başarılıysa çağrılır. */
  deleteImage(id: string): Promise<boolean>;
}

interface ExpiredImageRow {
  id: string;
  storage_path: string;
}

export class PgRetentionRepository implements RetentionRepository {
  constructor(private readonly pool: Pool) {}

  async findExpiredImages(now: Date, limit: number): Promise<ExpiredImage[]> {
    const { rows } = await this.pool.query<ExpiredImageRow>(
      `SELECT i.id, i.storage_path
         FROM report_images i
         JOIN reports r ON r.id = i.report_id
        WHERE r.retention_expires_at <= $1
        ORDER BY r.retention_expires_at ASC, i.created_at ASC, i.id ASC
        LIMIT $2`,
      [now, limit],
    );

    return rows.map((row) => ({ id: row.id, storagePath: row.storage_path }));
  }

  async deleteImage(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM report_images WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
