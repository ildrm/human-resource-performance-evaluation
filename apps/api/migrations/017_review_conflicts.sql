CREATE TABLE review_conflicts (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('SUBMISSION','CALIBRATION','PUBLICATION')),
  category text NOT NULL CHECK (category IN ('PERSONAL_RELATIONSHIP','REPORTING_CONFLICT','FINANCIAL_INTEREST','PRIOR_INVOLVEMENT','OTHER')),
  reason text NOT NULL,
  declared_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  replacement_actor_id uuid,
  resolution_note text,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,evaluation_id,stage,declared_by),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES evaluations(tenant_id,id),
  FOREIGN KEY (tenant_id,declared_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,replacement_actor_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,resolved_by) REFERENCES users(tenant_id,id),
  CHECK ((status='OPEN' AND replacement_actor_id IS NULL AND resolution_note IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status='RESOLVED' AND replacement_actor_id IS NOT NULL AND resolution_note IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX review_conflicts_gate ON review_conflicts(tenant_id,evaluation_id,stage,status);

CREATE TABLE review_conflict_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conflict_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('DECLARED','RESOLVED')),
  note text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,conflict_id) REFERENCES review_conflicts(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER review_conflict_events_append_only BEFORE UPDATE OR DELETE ON review_conflict_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

ALTER TABLE review_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_conflict_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON review_conflicts USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON review_conflict_events USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
