CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  audit_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('TENANT_ADMIN','HR_ADMIN','MANAGER','EMPLOYEE','CALIBRATOR','AUDITOR')),
  manager_id uuid,
  job_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS jobs (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  family text NOT NULL,
  purpose text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, name, version)
);

CREATE TABLE IF NOT EXISTS metrics (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  construct text NOT NULL,
  unit text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('HIGHER','LOWER','RANGE','BINARY','MILESTONE','RUBRIC')),
  rationale text NOT NULL,
  limitations text NOT NULL,
  controllability text NOT NULL,
  minimum_sample integer NOT NULL DEFAULT 0 CHECK (minimum_sample >= 0),
  guardrail_metric_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS templates (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  dimensions jsonb NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, job_id, version),
  FOREIGN KEY (tenant_id, job_id) REFERENCES jobs(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS targets (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  metric_id uuid NOT NULL,
  employee_id uuid,
  version integer NOT NULL CHECK (version > 0),
  effective_from date NOT NULL,
  effective_to date,
  critical numeric(20,8) NOT NULL,
  threshold numeric(20,8) NOT NULL,
  target numeric(20,8) NOT NULL,
  stretch numeric(20,8) NOT NULL,
  anchors jsonb NOT NULL,
  reason text NOT NULL,
  approved_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,metric_id) REFERENCES metrics(tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS targets_version_key ON targets(tenant_id,metric_id,coalesce(employee_id,'00000000-0000-0000-0000-000000000000'::uuid),version);
CREATE INDEX IF NOT EXISTS targets_lookup ON targets(tenant_id,metric_id,employee_id,effective_from DESC);

CREATE TABLE IF NOT EXISTS cycles (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('DEVELOPMENT','ADMINISTRATIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS evidence (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  metric_id uuid NOT NULL,
  observed_at timestamptz NOT NULL,
  value numeric(20,8),
  data_state text NOT NULL,
  source text NOT NULL,
  external_ref text,
  note text,
  numerator numeric(20,8),
  denominator numeric(20,8),
  verification_state text NOT NULL DEFAULT 'PENDING' CHECK (verification_state IN ('PENDING','VERIFIED','REJECTED')),
  verified_by uuid,
  verified_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,metric_id) REFERENCES metrics(tenant_id,id),
  CONSTRAINT evidence_external_ref_unique UNIQUE (tenant_id,source,external_ref)
);
CREATE INDEX IF NOT EXISTS evidence_employee_period ON evidence(tenant_id,employee_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS evaluations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  template_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('INCOMPLETE','CALCULATED','SUBMITTED','PUBLISHED','ACKNOWLEDGED','APPEALED')),
  score numeric(12,4),
  final_score numeric(12,4),
  input_snapshot jsonb NOT NULL,
  result_snapshot jsonb NOT NULL,
  manager_note text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,employee_id,cycle_id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,cycle_id) REFERENCES cycles(tenant_id,id),
  FOREIGN KEY (tenant_id,template_id) REFERENCES templates(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS calibration_decisions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL,
  previous_score numeric(12,4) NOT NULL,
  proposed_score numeric(12,4) NOT NULL,
  reason text NOT NULL,
  evidence_reference text NOT NULL,
  policy_basis text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES evaluations(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS appeals (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  reason text NOT NULL,
  statement text NOT NULL,
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED')),
  resolution text,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES evaluations(tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}',
  previous_hash text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id)
);

CREATE TABLE IF NOT EXISTS outbox (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  PRIMARY KEY (tenant_id,id)
);

ALTER TABLE users ADD CONSTRAINT users_manager_fk FOREIGN KEY (tenant_id,manager_id) REFERENCES users(tenant_id,id);
ALTER TABLE users ADD CONSTRAINT users_job_fk FOREIGN KEY (tenant_id,job_id) REFERENCES jobs(tenant_id,id);
ALTER TABLE metrics ADD CONSTRAINT metrics_guardrail_fk FOREIGN KEY (tenant_id,guardrail_metric_id) REFERENCES metrics(tenant_id,id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','jobs','metrics','templates','targets','cycles','evidence','evaluations','calibration_decisions','appeals','audit_events','outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
