-- Down migration for 20260509000003_audit_log.sql.
--
-- Drops the audit_log table along with its indexes (cascade on table drop).
-- The GRANTs are removed implicitly when the table is dropped.

DROP TABLE IF EXISTS audit_log;
