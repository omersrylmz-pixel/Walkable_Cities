-- Up Migration
-- Faz 5: yönetici ayarları, değiştirilemez sistem denetim izi ve analitik indeksleri.

-- 1) KVKK / saklama politikası da system_setting üzerinde tutulur.
INSERT INTO system_setting (key, value, description) VALUES
    ('privacy.policy',
     '{"retention_days": 730, "anonymization_required": true}'::jsonb,
     'KVKK politikası: saklama süresi (gün) ve anonimleştirme zorunluluğu.')
ON CONFLICT (key) DO NOTHING;

-- 2) Sistem düzeyi denetim izi. İhbar denetiminden (report_audit_log) ayrıdır:
--    eşik/KVKK değişiklikleri tek bir ihbara bağlı değildir.
CREATE TABLE IF NOT EXISTS system_audit_log (
    id          bigserial   PRIMARY KEY,
    actor_id    uuid        REFERENCES app_user(id) ON DELETE SET NULL,
    action      text        NOT NULL,
    target_key  text,
    before      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    after       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_audit_log IS
    'Sistem ayarları ve yönetici işlemlerinin değiştirilemez denetim izi.';

CREATE INDEX IF NOT EXISTS idx_system_audit_created
    ON system_audit_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_system_audit_actor
    ON system_audit_log (actor_id, created_at DESC);

-- 3) H3 analitiği için tarih + tür filtrelerini hızlandıran bileşik indeks.
CREATE INDEX IF NOT EXISTS idx_reports_analytics
    ON reports (violation_type, captured_at DESC)
    WHERE h3_cell IS NOT NULL AND status <> 'failed';

-- Down Migration
DROP INDEX IF EXISTS idx_reports_analytics;
DROP INDEX IF EXISTS idx_system_audit_actor;
DROP INDEX IF EXISTS idx_system_audit_created;
DROP TABLE IF EXISTS system_audit_log;
DELETE FROM system_setting WHERE key = 'privacy.policy';
