-- Up Migration
-- Faz 5: H3 hücre hesabındaki enlem/boylam sırası hatası.
--
-- `h3_lat_lng_to_cell(latlng point, resolution)` PostGIS geleneğine uygun
-- olarak point'i (boylam, enlem) sırasıyla okur. Tetikleyicisi ise
-- POINT(ST_Y, ST_X) vererek enlemi boylam yerine koyuyordu; bu yüzden
-- hücreler İstanbul yerine (~29°K / 41°D) düşüyordu. Sınır poligonları
-- zaten doğru sıradadır, yalnızca giriş düzeltilir.

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
        -- olduğu için açık cast gerekir. point (boylam, enlem) sırasındadır.
        EXECUTE 'SELECT h3_lat_lng_to_cell(POINT($1, $2), $3)::bigint'
           INTO v_cell
           USING ST_X(NEW.location), ST_Y(NEW.location), NEW.h3_resolution;

        NEW.h3_cell := v_cell;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_report_h3_cell() IS
    'INSERT/UPDATE sırasında GPS konumundan H3 hücresini üretir (h3-pg varsa); point (boylam, enlem) sırasındadır.';

-- Mevcut kayıtların hücrelerini doğru koordinat sırasıyla yeniden hesapla.
UPDATE reports
   SET h3_cell = h3_lat_lng_to_cell(
                    POINT(ST_X(location), ST_Y(location)),
                    h3_resolution
                 )::bigint
 WHERE location IS NOT NULL
   AND h3_cell IS DISTINCT FROM
       h3_lat_lng_to_cell(POINT(ST_X(location), ST_Y(location)), h3_resolution)::bigint;

-- Down Migration
-- Tetikleyicisi eski (hatalı) sırasına döner; yeniden hesaplanan hücreler
-- geri alınamaz, yalnızca bir sonraki INSERT/UPDATE ile eski davranışı üretir.
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
        EXECUTE 'SELECT h3_lat_lng_to_cell(POINT($1, $2), $3)::bigint'
           INTO v_cell
           USING ST_Y(NEW.location), ST_X(NEW.location), NEW.h3_resolution;

        NEW.h3_cell := v_cell;
    END IF;

    RETURN NEW;
END;
$$;
