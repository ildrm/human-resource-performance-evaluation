CREATE TABLE goals (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('DEVELOPMENT','ADMINISTRATIVE')),
  kind text NOT NULL CHECK (kind IN ('PERFORMANCE','LEARNING','PROJECT','TEAM','STRATEGIC','COMPLIANCE','IMPROVEMENT','RECOVERY')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,cycle_id) REFERENCES cycles(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX goals_employee_cycle ON goals(tenant_id,employee_id,cycle_id);

CREATE TABLE goal_revisions (
  tenant_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  effective_at timestamptz NOT NULL,
  description text NOT NULL,
  baseline text NOT NULL,
  threshold text NOT NULL,
  target text NOT NULL,
  stretch text NOT NULL,
  due_date date NOT NULL,
  priority text NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH')),
  weight numeric(6,5) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 1)),
  review_cadence text NOT NULL CHECK (review_cadence IN ('WEEKLY','BIWEEKLY','MONTHLY','QUARTERLY')),
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  reason text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,goal_id,version),
  UNIQUE (tenant_id,goal_id,effective_at),
  FOREIGN KEY (tenant_id,goal_id) REFERENCES goals(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);

CREATE TABLE goal_checkins (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  progress text NOT NULL,
  obstacle text,
  support_needed text,
  evidence_reference text,
  next_action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,goal_id) REFERENCES goals(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX goal_checkins_timeline ON goal_checkins(tenant_id,goal_id,created_at DESC);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON goals USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON goal_revisions USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON goal_checkins USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
