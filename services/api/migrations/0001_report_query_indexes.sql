-- Up Migration
-- Faz 1: ihbar listesi ve mükerrer tespiti sorgularını hızlandıran indeksler.
-- (Temel şema infra/init.sql içinde; burada yalnızca ek/iyileştirme indeksleri var.)

-- Liste uçları: tür + zaman ve durum + zaman filtreleri.
CREATE INDEX IF NOT EXISTS idx_reports_type_captured
    ON reports (violation_type, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_status_captured
    ON reports (status, captured_at DESC);

-- Birebir görsel mükerrerliği: aynı sha256 için en eski kaydı bulur.
CREATE INDEX IF NOT EXISTS idx_report_images_sha256_created
    ON report_images (sha256, created_at ASC);

-- Yakın mükerrerlik: tür + zaman aralığında konum taraması.
CREATE INDEX IF NOT EXISTS idx_reports_type_captured_not_duplicate
    ON reports (violation_type, captured_at DESC)
    WHERE duplicate_of IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_reports_type_captured_not_duplicate;
DROP INDEX IF EXISTS idx_report_images_sha256_created;
DROP INDEX IF EXISTS idx_reports_status_captured;
DROP INDEX IF EXISTS idx_reports_type_captured;
