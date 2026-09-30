CREATE TABLE development_actions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  goal_id uuid,
  competency_gap text NOT NULL,
  current_level text NOT NULL,
  target_level text NOT NULL,
  activity text NOT NULL,
  training text,
  mentor_id uuid,
  stretch_assignment text,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED')),
  created_by uuid NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,cycle_id) REFERENCES cycles(tenant_id,id),
  FOREIGN KEY (tenant_id,goal_id) REFERENCES goals(tenant_id,id),
  FOREIGN KEY (tenant_id,mentor_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX development_actions_employee_cycle ON development_actions(tenant_id,employee_id,cycle_id);

CREATE TABLE development_action_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PROGRESS','REVIEW','COMPLETED','CANCELLED')),
  note text NOT NULL,
  evidence_reference text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,action_id) REFERENCES development_actions(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX development_action_events_timeline ON development_action_events(tenant_id,action_id,created_at);

ALTER TABLE development_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE development_action_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON development_actions USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON development_action_events USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
