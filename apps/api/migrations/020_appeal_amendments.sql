ALTER TABLE appeals ADD COLUMN IF NOT EXISTS outcome text
  CHECK (outcome IN ('UPHELD','PARTIALLY_UPHELD','DENIED'));
ALTER TABLE appeals ADD COLUMN IF NOT EXISTS remedy text;
ALTER TABLE appeals ADD COLUMN IF NOT EXISTS notice_status text NOT NULL DEFAULT 'NOT_QUEUED'
  CHECK (notice_status IN ('NOT_QUEUED','PENDING','DELIVERED','FAILED'));

CREATE TABLE IF NOT EXISTS evaluation_amendments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL,
  appeal_id uuid NOT NULL,
  previous_effective_score numeric(12,4) NOT NULL,
  amended_score numeric(12,4) NOT NULL CHECK (amended_score >= 0 AND amended_score <= 120),
  reason text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,appeal_id),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES evaluations(tenant_id,id),
  FOREIGN KEY (tenant_id,appeal_id) REFERENCES appeals(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS evaluation_amendments_latest
  ON evaluation_amendments(tenant_id,evaluation_id,created_at DESC,id DESC);
CREATE TRIGGER evaluation_amendments_append_only
  BEFORE UPDATE OR DELETE ON evaluation_amendments
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
ALTER TABLE evaluation_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON evaluation_amendments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
