ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text;

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS engine_version text;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS input_schema_version integer;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS engine_artifact_hash text;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS input_hash text;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS result_hash text;

UPDATE evaluations
SET engine_version = '1.0.0', input_schema_version = 1
WHERE engine_version IS NULL;

COMMENT ON COLUMN evaluations.engine_artifact_hash IS
  'SHA-256 of executed calculation source files; NULL for legacy records whose artifact was not captured.';
COMMENT ON COLUMN evaluations.input_hash IS
  'SHA-256 of canonical JSON input; NULL for legacy records without a preserved hash.';

CREATE INDEX IF NOT EXISTS evaluations_tenant_engine_version
  ON evaluations(tenant_id, engine_version);
