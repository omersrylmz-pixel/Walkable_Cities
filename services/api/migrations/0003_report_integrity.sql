-- Up Migration
-- Faz 3: EXIF doğrulama ve KVKK anonimleştirme durumunun izlenmesi.

-- EXIF karşılaştırma sonuçları ve anonimleştirme özeti tek jsonb kolonda tutulur.
-- Örnek:
-- {
--   "exif": { "present": true, "capturedAt": "2026-03-15T11:58:00", "gps": {...} },
--   "checks": { "gps": {"status":"match","difference":4.2,"tolerance":100}, ... },
--   "anonymization": { "status": "applied", "facesBlurred": 1, "platesBlurred": 0 }
-- }
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS integrity jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN reports.integrity IS
    'EXIF GPS/zaman çapraz doğrulaması ve anonimleştirme sonucu (denetim amaçlı).';

-- Anonimleştirmesi henüz tamamlanmamış kayıtları hızlı bulur (telafi işi).
CREATE INDEX IF NOT EXISTS idx_reports_anonymization_pending
    ON reports (created_at ASC)
    WHERE anonymized_at IS NULL;

-- Saklama süresi dolan görselleri temizleyen iş için.
CREATE INDEX IF NOT EXISTS idx_reports_retention_expires
    ON reports (retention_expires_at ASC);

-- Down Migration
DROP INDEX IF EXISTS idx_reports_retention_expires;
DROP INDEX IF EXISTS idx_reports_anonymization_pending;
ALTER TABLE reports DROP COLUMN IF EXISTS integrity;
