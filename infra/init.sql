-- =============================================================================
-- Yaya Alanı İhlal Tespiti ve Şehir Analiz Platformu
-- Faz 0 — Temel veritabanı şeması
--
-- PostgreSQL 16 + PostGIS 3.4 + h3-pg (opsiyonel)
--
-- Bu dosya yalnızca BOŞ bir veri dizininde (docker-entrypoint-initdb.d) çalışır.
-- Faz 1'den itibaren şema değişiklikleri sürümlü migrasyonlarla yönetilecektir.
--
-- Adlandırma notu:
--   Enum değerleri ASCII tutulur (ör. kaldirim_isgali). Türkçe görünen adlar
--   violation_type_catalog.label_tr alanında saklanır.
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 0) Eklentiler
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- e-posta tekil kontrolü
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- adres/açıklama araması

-- h3-pg her ortamda bulunmayabilir (ör. yönetilen Supabase).
-- Bu durumda h3_cell uygulama katmanında hesaplanır.
DO $h3_ext$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'h3') THEN
        CREATE EXTENSION IF NOT EXISTS h3;
        RAISE NOTICE '[init] h3-pg eklentisi etkinlestirildi.';
    ELSE
        RAISE NOTICE '[init] h3-pg bulunamadi; h3_cell alanlari uygulama katmaninda doldurulacak.';
    END IF;
END
$h3_ext$;

-- -----------------------------------------------------------------------------
-- 1) Numaralandırma tipleri
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE violation_type AS ENUM (
        'kaldirim_isgali',      -- kaldırım işgali
        'yaya_gecidi_ihlali',   -- yaya geçidi ihlali
        'sabit_engel',          -- sabit engel
        'yuzey_bozulmasi',      -- yüzey bozulması
        'gecici_engel'          -- geçici engel
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE report_status AS ENUM (
        'draft',           -- istemcide oluşturuldu, yüklenmedi
        'queued',          -- API'ye ulaştı, işlenmeyi bekliyor
        'processing',      -- AI değerlendirmesinde
        'auto_approved',   -- skor >= 0.85
        'pending_review',  -- 0.60 <= skor < 0.85
        'auto_rejected',   -- skor < 0.60
        'approved',        -- manuel kabul
        'rejected',        -- manuel ret
        'failed'           -- işleme hatası
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE decision_outcome AS ENUM (
        'auto_accept',
        'manual_review',
        'auto_reject',
        'manual_accept',
        'manual_reject'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'citizen',            -- vatandaş (mobil)
        'moderator',          -- manuel inceleme
        'municipality_admin', -- belediye yöneticisi
        'analyst',            -- mekânsal analiz
        'service'             -- makine-makine hesabı
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE media_kind AS ENUM ('original', 'anonymized', 'thumbnail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE hotspot_method AS ENUM ('dbscan', 'getis_ord_gi');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE cluster_class AS ENUM ('hot', 'cold', 'not_significant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 2) Referans ve konfigürasyon tabloları
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS violation_type_catalog (
    code              violation_type PRIMARY KEY,
    label_tr          text        NOT NULL,
    description       text,
    default_severity  smallint    NOT NULL DEFAULT 3 CHECK (default_severity BETWEEN 1 AND 5),
    is_active         boolean     NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE violation_type_catalog IS
    'İhlal türlerinin Türkçe etiketleri, açıklamaları ve varsayılan ağırlıkları.';

INSERT INTO violation_type_catalog (code, label_tr, description, default_severity) VALUES
    ('kaldirim_isgali',    'Kaldırım İşgali',
     'Araç, tabela, tezgâh veya eşya ile kaldırımın yaya kullanımına kapatılması.', 4),
    ('yaya_gecidi_ihlali', 'Yaya Geçidi İhlali',
     'Yaya geçidinin araç parkı, malzeme veya engel ile kapatılması.', 5),
    ('sabit_engel',        'Sabit Engel',
     'Direk, trafo, çöp konteyneri gibi kalıcı ve konum değiştirmeyen engeller.', 3),
    ('yuzey_bozulmasi',    'Yüzey Bozulması',
     'Çukur, kırık kaldırım taşı, çökme gibi erişilebilirliği düşüren yüzey kusurları.', 3),
    ('gecici_engel',       'Geçici Engel',
     'İnşaat malzemesi, moloz, geçici tabela gibi süreli engeller.', 2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS system_setting (
    key          text        PRIMARY KEY,
    value        jsonb       NOT NULL,
    description  text,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE system_setting IS
    'Çalışma zamanı yapılandırması. Karar eşikleri burada tutulur.';

INSERT INTO system_setting (key, value, description) VALUES
    ('decision.thresholds',
     '{"auto_accept": 0.85, "manual_review": 0.60}'::jsonb,
     'Güven skoru karar eşikleri: >= auto_accept otomatik kabul, >= manual_review manuel inceleme, altı otomatik ret.')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) Kullanıcılar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    external_auth_id text        UNIQUE,
    display_name     text,
    email            citext      UNIQUE,
    role             user_role   NOT NULL DEFAULT 'citizen',
    kvkk_consent_at  timestamptz,
    kvkk_consent_ver text,
    is_active        boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_user IS
    'Platform kullanıcıları. Kimlik doğrulama harici sağlayıcıda (Supabase Auth) tutulur.';

-- -----------------------------------------------------------------------------
-- 4) İhbarlar
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    id                    uuid             PRIMARY KEY DEFAULT gen_random_uuid(),

    -- İstemci tarafından üretilen tekil kimlik: ağ tekrarlarında idempotency sağlar.
    client_report_id      uuid             NOT NULL UNIQUE,
    reporter_id           uuid             REFERENCES app_user(id) ON DELETE SET NULL,

    violation_type        violation_type   NOT NULL,
    status                report_status    NOT NULL DEFAULT 'queued',
    decision              decision_outcome,
    confidence_score      numeric(4,3)
                          CHECK (confidence_score IS NULL
                                 OR (confidence_score >= 0 AND confidence_score <= 1)),
    severity              smallint         CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
    description           text,

    -- Zaman damgaları
    captured_at           timestamptz      NOT NULL,
    received_at           timestamptz      NOT NULL DEFAULT now(),

    -- Konum
    location              geometry(Point, 4326) NOT NULL,
    gps_accuracy_m        numeric(6,2)     CHECK (gps_accuracy_m IS NULL OR gps_accuracy_m >= 0),
    gps_source            text             NOT NULL DEFAULT 'device'
                          CHECK (gps_source IN ('device', 'exif', 'manual')),
    address_text          text,

    -- H3 altıgen indeksleme (res 9 ≈ 0.1 km²)
    h3_resolution         smallint         NOT NULL DEFAULT 9
                          CHECK (h3_resolution BETWEEN 0 AND 15),
    h3_cell               bigint,

    -- Mükerrer kayıt yönetimi
    duplicate_of          uuid             REFERENCES reports(id) ON DELETE SET NULL,
    duplicate_score       numeric(4,3)
                          CHECK (duplicate_score IS NULL
                                 OR (duplicate_score >= 0 AND duplicate_score <= 1)),

    -- KVKK / saklama
    anonymized_at         timestamptz,
    retention_expires_at  timestamptz      NOT NULL DEFAULT (now() + interval '2 years'),

    -- İşleme meta verisi
    model_version         text,
    device_info           jsonb            NOT NULL DEFAULT '{}'::jsonb,
    ai_metadata           jsonb            NOT NULL DEFAULT '{}'::jsonb,
    -- EXIF GPS/zaman çapraz doğrulaması + anonimleştirme özeti (Faz 3).
    integrity             jsonb            NOT NULL DEFAULT '{}'::jsonb,

    -- Moderasyon
    reviewed_by           uuid             REFERENCES app_user(id) ON DELETE SET NULL,
    reviewed_at           timestamptz,
    review_note           text,

    created_at            timestamptz      NOT NULL DEFAULT now(),
    updated_at            timestamptz      NOT NULL DEFAULT now(),

    CONSTRAINT reports_review_consistency CHECK (
        (reviewed_by IS NULL AND reviewed_at IS NULL)
        OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);

COMMENT ON TABLE reports IS
    'Vatandaş ihbarlarının ana kaydı: konum, zaman, ihlal türü, AI güven skoru ve karar.';
COMMENT ON COLUMN reports.client_report_id IS
    'Mobil uygulamada üretilen UUID; tekrar gönderimlerde mükerrer kaydı engeller.';
COMMENT ON COLUMN reports.h3_cell IS
    'H3 hücre indeksi (bigint). h3-pg yoksa uygulama katmanında hesaplanır.';
COMMENT ON COLUMN reports.decision IS
    'Karar motoru çıktısı; skor eşiklerine göre otomatik veya manuel atanır.';
COMMENT ON COLUMN reports.retention_expires_at IS
    'KVKK saklama süresi sonu; görseller bu tarihten sonra silinir.';

-- -----------------------------------------------------------------------------
-- 5) Görseller (KVKK + mükerrer tespiti)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_images (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id        uuid        NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    kind             media_kind  NOT NULL DEFAULT 'original',
    storage_path     text        NOT NULL,
    mime_type        text        NOT NULL DEFAULT 'image/jpeg',
    byte_size        bigint      CHECK (byte_size IS NULL OR byte_size > 0),
    width            integer     CHECK (width IS NULL OR width > 0),
    height           integer     CHECK (height IS NULL OR height > 0),

    -- İçerik hash'i: aynı görselin tekrar yüklenmesini tespit eder.
    sha256           bytea       NOT NULL,

    -- KVKK anonimleştirme durumu
    blur_applied     boolean     NOT NULL DEFAULT false,
    faces_blurred    integer     NOT NULL DEFAULT 0 CHECK (faces_blurred >= 0),
    plates_blurred   integer     NOT NULL DEFAULT 0 CHECK (plates_blurred >= 0),
    exif_removed     boolean     NOT NULL DEFAULT false,

    created_at       timestamptz NOT NULL DEFAULT now(),

    UNIQUE (report_id, kind)
);

COMMENT ON TABLE report_images IS
    'İhbar görselleri. Orijinal ve anonimleştirilmiş kopyalar ayrı kayıt olarak tutulur.';
COMMENT ON COLUMN report_images.sha256 IS
    'Görsel içeriğinin SHA-256 özeti (mükerrer ihbar kontrolü).';

-- -----------------------------------------------------------------------------
-- 6) AI değerlendirme kayıtları
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_evaluations (
    id                  bigserial        PRIMARY KEY,
    report_id           uuid             NOT NULL REFERENCES reports(id) ON DELETE CASCADE,

    detector_name       text             NOT NULL,   -- yolo26 / rf-detr
    detector_version    text,
    segmenter_name      text,                        -- kaldirim / yaya_gecidi maskesi
    segmenter_version   text,

    detector_confidence numeric(4,3)
                        CHECK (detector_confidence IS NULL
                               OR (detector_confidence >= 0 AND detector_confidence <= 1)),
    overlap_ratio       numeric(4,3)
                        CHECK (overlap_ratio IS NULL
                               OR (overlap_ratio >= 0 AND overlap_ratio <= 1)),
    walkable_area_ratio numeric(4,3)
                        CHECK (walkable_area_ratio IS NULL
                               OR (walkable_area_ratio >= 0 AND walkable_area_ratio <= 1)),

    detections          jsonb            NOT NULL DEFAULT '[]'::jsonb,
    thresholds          jsonb            NOT NULL DEFAULT '{}'::jsonb,
    outcome             decision_outcome NOT NULL,
    latency_ms          integer          CHECK (latency_ms IS NULL OR latency_ms >= 0),

    created_at          timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE report_evaluations IS
    'Her AI çalıştırmasının izlenebilir kaydı: model sürümü, tespitler, overlap oranı ve karar.';
COMMENT ON COLUMN report_evaluations.overlap_ratio IS
    'Engel maskesinin kaldırım/yaya geçidi maskesiyle örtüşme oranı (0-1).';

-- -----------------------------------------------------------------------------
-- 7) Denetim izi (KVKK + moderasyon)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_audit_log (
    id          bigserial      PRIMARY KEY,
    report_id   uuid           NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    actor_id    uuid           REFERENCES app_user(id) ON DELETE SET NULL,
    action      text           NOT NULL,
    from_status report_status,
    to_status   report_status,
    payload     jsonb          NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz    NOT NULL DEFAULT now()
);

COMMENT ON TABLE report_audit_log IS
    'Durum geçişleri ve moderasyon işlemlerinin değiştirilemez denetim izi.';

-- -----------------------------------------------------------------------------
-- 8) Mekânsal analiz çıktıları (DBSCAN / Getis-Ord Gi*)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hotspot_analyses (
    id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    method           hotspot_method  NOT NULL,
    h3_resolution    smallint        NOT NULL CHECK (h3_resolution BETWEEN 0 AND 15),
    violation_type   violation_type,
    window_start     timestamptz,
    window_end       timestamptz,
    params           jsonb           NOT NULL DEFAULT '{}'::jsonb,
    cell_count       integer         NOT NULL DEFAULT 0,
    created_by       uuid            REFERENCES app_user(id) ON DELETE SET NULL,
    created_at       timestamptz     NOT NULL DEFAULT now(),
    notes            text,
    CONSTRAINT hotspot_window_consistency CHECK (
        window_start IS NULL OR window_end IS NULL OR window_start <= window_end
    )
);

CREATE TABLE IF NOT EXISTS hotspot_cells (
    analysis_id    uuid           NOT NULL REFERENCES hotspot_analyses(id) ON DELETE CASCADE,
    h3_cell        bigint         NOT NULL,
    report_count   integer        NOT NULL DEFAULT 0 CHECK (report_count >= 0),
    gi_z_score     numeric(8,4),
    p_value        numeric(6,5)   CHECK (p_value IS NULL OR (p_value >= 0 AND p_value <= 1)),
    cluster_class  cluster_class  NOT NULL DEFAULT 'not_significant',
    centroid       geometry(Point, 4326),
    PRIMARY KEY (analysis_id, h3_cell)
);

COMMENT ON TABLE hotspot_cells IS
    'Bir analiz çalıştırmasının H3 hücre bazlı sonuçları (Gi* z-skoru, sınıf).';

-- -----------------------------------------------------------------------------
-- 9) Fonksiyonlar
-- -----------------------------------------------------------------------------

-- 9.1 Karar eşiklerini system_setting'den okuyarak skoru sınıflandırır.
CREATE OR REPLACE FUNCTION decision_for_score(p_score numeric)
RETURNS decision_outcome
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_auto_threshold   numeric := 0.85;
    v_manual_threshold numeric := 0.60;
    v_config           jsonb;
BEGIN
    IF p_score IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT value INTO v_config
    FROM system_setting
    WHERE key = 'decision.thresholds';

    IF v_config IS NOT NULL THEN
        v_auto_threshold   := COALESCE((v_config ->> 'auto_accept')::numeric, v_auto_threshold);
        v_manual_threshold := COALESCE((v_config ->> 'manual_review')::numeric, v_manual_threshold);
    END IF;

    IF p_score >= v_auto_threshold THEN
        RETURN 'auto_accept';
    ELSIF p_score >= v_manual_threshold THEN
        RETURN 'manual_review';
    ELSE
        RETURN 'auto_reject';
    END IF;
END;
$$;

COMMENT ON FUNCTION decision_for_score(numeric) IS
    'Güven skorunu 3 aşamalı karara çevirir. Eşikler system_setting.decision.thresholds üzerinden okunur.';

-- 9.2 Skor geldiğinde kararı ve durumu otomatik atar; manuel kararları korur.
CREATE OR REPLACE FUNCTION apply_report_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_auto_decision decision_outcome;
BEGIN
    IF NEW.confidence_score IS NULL THEN
        RETURN NEW;
    END IF;

    -- Manuel kararlar (manual_accept / manual_reject) ezilmez.
    IF NEW.decision IS NOT NULL
       AND NEW.decision NOT IN ('auto_accept', 'manual_review', 'auto_reject') THEN
        RETURN NEW;
    END IF;

    v_auto_decision := decision_for_score(NEW.confidence_score);
    NEW.decision := v_auto_decision;

    IF NEW.status IN ('draft', 'queued', 'processing',
                      'auto_approved', 'pending_review', 'auto_rejected') THEN
        NEW.status := CASE v_auto_decision
            WHEN 'auto_accept'   THEN 'auto_approved'::report_status
            WHEN 'manual_review' THEN 'pending_review'::report_status
            ELSE 'auto_rejected'::report_status
        END;
    END IF;

    RETURN NEW;
END;
$$;

-- 9.3 h3-pg varsa konumdan H3 hücresini hesaplar.
CREATE OR REPLACE FUNCTION set_report_h3_cell()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_cell bigint;
BEGIN
    IF NEW.location IS NULL THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'h3') THEN
        -- h3-pg hücreleri `h3index` (8 baytlık özel tip) döner; kolon bigint
        -- olduğu için açık cast gerekir.
        EXECUTE 'SELECT h3_lat_lng_to_cell(POINT($1, $2), $3)::bigint'
           INTO v_cell
           USING ST_Y(NEW.location), ST_X(NEW.location), NEW.h3_resolution;

        NEW.h3_cell := v_cell;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_report_h3_cell() IS
    'INSERT/UPDATE sırasında GPS konumundan H3 hücresini üretir (h3-pg varsa).';

-- 9.4 Zaman damgası sağlık kontrolü (GPS saati manipülasyonu / yanlış saat dilimi).
CREATE OR REPLACE FUNCTION validate_report_temporal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.captured_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'captured_at gelecekte olamaz (%)', NEW.captured_at
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.captured_at < now() - interval '180 days' THEN
        RAISE EXCEPTION 'captured_at 180 günden eski olamaz (%)', NEW.captured_at
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- 9.5 updated_at bakımı
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 10) Tetikleyiciler
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_reports_validate_temporal ON reports;
CREATE TRIGGER trg_reports_validate_temporal
    BEFORE INSERT OR UPDATE OF captured_at ON reports
    FOR EACH ROW EXECUTE FUNCTION validate_report_temporal();

DROP TRIGGER IF EXISTS trg_reports_apply_decision ON reports;
CREATE TRIGGER trg_reports_apply_decision
    BEFORE INSERT OR UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION apply_report_decision();

DROP TRIGGER IF EXISTS trg_reports_h3_cell ON reports;
CREATE TRIGGER trg_reports_h3_cell
    BEFORE INSERT OR UPDATE OF location, h3_resolution ON reports
    FOR EACH ROW EXECUTE FUNCTION set_report_h3_cell();

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_app_user_updated_at ON app_user;
CREATE TRIGGER trg_app_user_updated_at
    BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_system_setting_updated_at ON system_setting;
CREATE TRIGGER trg_system_setting_updated_at
    BEFORE UPDATE ON system_setting
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- -----------------------------------------------------------------------------
-- 11) İndeksler
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reports_location_gist
    ON reports USING gist (location);

CREATE INDEX IF NOT EXISTS idx_reports_h3_cell
    ON reports (h3_cell)
    WHERE h3_cell IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_status_created
    ON reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_type_created
    ON reports (violation_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_review_band
    ON reports (confidence_score DESC)
    WHERE status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_reports_captured_brin
    ON reports USING brin (captured_at);

CREATE INDEX IF NOT EXISTS idx_reports_duplicate_of
    ON reports (duplicate_of)
    WHERE duplicate_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_images_report
    ON report_images (report_id);

CREATE INDEX IF NOT EXISTS idx_report_images_sha256
    ON report_images (sha256);

CREATE INDEX IF NOT EXISTS idx_report_evaluations_report
    ON report_evaluations (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_audit_report
    ON report_audit_log (report_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hotspot_cells_analysis
    ON hotspot_cells (analysis_id);

CREATE INDEX IF NOT EXISTS idx_hotspot_cells_centroid_gist
    ON hotspot_cells USING gist (centroid);

-- -----------------------------------------------------------------------------
-- 12) Görünümler
-- -----------------------------------------------------------------------------

-- 12.1 Manuel inceleme kuyruğu (0.60 <= skor < 0.85)
CREATE OR REPLACE VIEW v_review_queue AS
SELECT
    r.id,
    r.violation_type,
    c.label_tr              AS violation_label,
    r.confidence_score,
    r.status,
    r.captured_at,
    r.received_at,
    r.location,
    r.h3_cell,
    r.gps_accuracy_m,
    r.duplicate_of,
    r.duplicate_score,
    (r.confidence_score >= 0.60 AND r.confidence_score < 0.85) AS in_review_band
FROM reports r
JOIN violation_type_catalog c ON c.code = r.violation_type
WHERE r.status = 'pending_review'
ORDER BY r.confidence_score DESC NULLS LAST, r.captured_at ASC;

COMMENT ON VIEW v_review_queue IS
    'Moderatörlerin öncelikli inceleme listesi: yüksek skorlu ama otomatik kabul eşiğini geçemeyen ihbarlar.';

-- 12.2 H3 hücresi + ihlal türü bazlı yoğunluk (sıcak nokta analizine girdi)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_h3_density AS
SELECT
    r.h3_cell,
    r.h3_resolution,
    r.violation_type,
    count(*)::integer                         AS report_count,
    avg(r.confidence_score)::numeric(4,3)     AS avg_confidence,
    min(r.captured_at)                        AS first_seen_at,
    max(r.captured_at)                        AS last_seen_at,
    ST_Centroid(ST_Collect(r.location))       AS centroid
FROM reports r
WHERE r.h3_cell IS NOT NULL
  AND r.status IN ('auto_approved', 'pending_review', 'approved')
GROUP BY r.h3_cell, r.h3_resolution, r.violation_type;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_h3_density
    ON mv_h3_density (h3_cell, violation_type);

CREATE INDEX IF NOT EXISTS idx_mv_h3_density_centroid_gist
    ON mv_h3_density USING gist (centroid);

COMMENT ON MATERIALIZED VIEW mv_h3_density IS
    'H3 hücresi bazlı ihbar yoğunluğu. REFRESH MATERIALIZED VIEW CONCURRENTLY ile yenilenir.';

-- -----------------------------------------------------------------------------
-- 13) Seed: servis hesabı (makine-makine)
-- -----------------------------------------------------------------------------
INSERT INTO app_user (display_name, email, role)
VALUES ('AI Service', 'ai-service@internal.local', 'service')
ON CONFLICT (email) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Bitiş
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    RAISE NOTICE '[init] Yaya alanı ihlal şeması hazır.';
END $$;
