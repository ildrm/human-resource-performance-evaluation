ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_state_check;
ALTER TABLE templates ADD CONSTRAINT templates_state_check
  CHECK (state IN ('DRAFT','REVIEW','VALIDATED','APPROVED','ACTIVE','RETIRED'));
ALTER TABLE templates ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS validated_by uuid;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS validated_at timestamptz;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS validation_note text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS fixture_evidence_reference text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS scientific_rationale text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS limitations text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS engine_version text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS retired_by uuid;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS retirement_reason text;

COMMENT ON COLUMN templates.created_by IS
  'NULL on legacy templates created before independent model governance was introduced.';
