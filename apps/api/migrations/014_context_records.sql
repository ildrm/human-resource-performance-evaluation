CREATE TABLE context_records (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('OPPORTUNITY','COMPLEXITY','RESOURCE','DISRUPTION','OTHER')),
  description text NOT NULL,
  impact text NOT NULL,
  evidence_reference text NOT NULL,
  expected_exposure numeric(20,8),
  actual_exposure numeric(20,8),
  exposure_unit text,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','VERIFIED','REJECTED')),
  created_by uuid NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,cycle_id) REFERENCES cycles(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,reviewed_by) REFERENCES users(tenant_id,id),
  CHECK ((expected_exposure IS NULL AND actual_exposure IS NULL AND exposure_unit IS NULL)
    OR (expected_exposure >= 0 AND actual_exposure >= 0 AND length(exposure_unit) > 0))
);
CREATE INDEX context_records_employee_cycle ON context_records(tenant_id,employee_id,cycle_id,status,created_at);

CREATE TABLE context_reviews (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  context_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('VERIFIED','REJECTED')),
  note text NOT NULL,
  evidence_reference text,
  reviewer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,context_id),
  FOREIGN KEY (tenant_id,context_id) REFERENCES context_records(tenant_id,id),
  FOREIGN KEY (tenant_id,reviewer_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER context_reviews_append_only
  BEFORE UPDATE OR DELETE ON context_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

ALTER TABLE context_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON context_records
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON context_reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
