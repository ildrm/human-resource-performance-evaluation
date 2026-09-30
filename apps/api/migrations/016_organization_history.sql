CREATE TABLE organization_units (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ORGANIZATION','SUBSIDIARY','LEGAL_ENTITY','COUNTRY','REGION','SITE','DIVISION','BUSINESS_UNIT','DEPARTMENT','TEAM','COST_CENTER','PROJECT_TEAM')),
  parent_id uuid,
  effective_from date NOT NULL,
  effective_to date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,code,effective_from),
  FOREIGN KEY (tenant_id,parent_id) REFERENCES organization_units(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX organization_units_lookup ON organization_units(tenant_id,code,effective_from);

CREATE TABLE employee_org_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  assignment_role text NOT NULL CHECK (assignment_role IN ('PRIMARY','MATRIX')),
  effective_from date NOT NULL,
  effective_to date,
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,unit_id) REFERENCES organization_units(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employee_org_assignments_lookup ON employee_org_assignments(tenant_id,employee_id,effective_from DESC);

CREATE TABLE employee_org_assignment_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CREATED','ENDED')),
  effective_to date,
  reason text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,assignment_id) REFERENCES employee_org_assignments(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE TRIGGER employee_org_assignment_events_append_only BEFORE UPDATE OR DELETE ON employee_org_assignment_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();

ALTER TABLE evaluations ADD COLUMN org_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE organization_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_org_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_org_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON organization_units USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON employee_org_assignments USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON employee_org_assignment_events USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
