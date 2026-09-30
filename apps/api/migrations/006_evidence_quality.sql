CREATE TABLE evidence_quality_policies (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  freshness_days integer NOT NULL CHECK (freshness_days > 0),
  unreferenced_evidence_factor numeric(5,4) NOT NULL CHECK (unreferenced_evidence_factor BETWEEN 0 AND 1),
  weights jsonb NOT NULL,
  rationale text NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')),
  created_by uuid NOT NULL,
  activated_by uuid,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,version),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,activated_by) REFERENCES users(tenant_id,id)
);
CREATE UNIQUE INDEX evidence_quality_one_active
  ON evidence_quality_policies(tenant_id) WHERE state='ACTIVE';
ALTER TABLE evidence_quality_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON evidence_quality_policies
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE evaluations ADD COLUMN quality_input_snapshot jsonb;
ALTER TABLE evaluations ADD COLUMN quality_result_snapshot jsonb;
