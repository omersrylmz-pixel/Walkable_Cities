-- Up Migration
-- Faz 1: ihbar durum geçişlerinin değiştirilemez denetim izi (KVKK + moderasyon).

CREATE OR REPLACE FUNCTION log_report_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO report_audit_log (report_id, action, to_status, payload)
        VALUES (NEW.id, 'report.created', NEW.status, jsonb_build_object('source', 'api'));
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO report_audit_log (report_id, action, from_status, to_status)
        VALUES (NEW.id, 'report.status_changed', OLD.status, NEW.status);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reports_audit_status ON reports;
CREATE TRIGGER trg_reports_audit_status
    AFTER INSERT OR UPDATE OF status ON reports
    FOR EACH ROW EXECUTE FUNCTION log_report_status_change();

-- Down Migration
DROP TRIGGER IF EXISTS trg_reports_audit_status ON reports;
DROP FUNCTION IF EXISTS log_report_status_change();
