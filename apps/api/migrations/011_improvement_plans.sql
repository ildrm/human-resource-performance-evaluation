CREATE TABLE improvement_plans (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  source_evaluation_id uuid NOT NULL,
  gap text NOT NULL,
  expected_standard text NOT NULL,
  supporting_evidence text NOT NULL,
  required_improvement text NOT NULL,
  support_provided text NOT NULL,
  measurement_criteria text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','DECIDED','APPEALED','CLOSED')),
  created_by uuid NOT NULL,
  activated_by uuid,
  decided_by uuid,
  decision text CHECK (decision IN ('MET','NOT_MET')),
  final_decision text CHECK (final_decision IN ('MET','NOT_MET')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  decided_at timestamptz,
  closed_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,source_evaluation_id) REFERENCES evaluations(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,activated_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,decided_by) REFERENCES users(tenant_id,id),
  CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX improvement_one_open_plan_per_employee
  ON improvement_plans(tenant_id,employee_id)
  WHERE status IN ('DRAFT','ACTIVE','DECIDED','APPEALED');
CREATE INDEX improvement_plans_employee_timeline ON improvement_plans(tenant_id,employee_id,created_at DESC);

CREATE TABLE improvement_plan_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ACTIVATED','EMPLOYEE_RESPONSE','REVIEW_MEETING','SUPPORT_UPDATE','DECISION','APPEAL','APPEAL_RESOLUTION','CLOSED')),
  note text NOT NULL,
  occurred_on date,
  outcome text CHECK (outcome IN ('MET','NOT_MET')),
  evidence_reference text,
  policy_reference text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,plan_id) REFERENCES improvement_plans(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX improvement_plan_events_timeline ON improvement_plan_events(tenant_id,plan_id,created_at,id);

CREATE FUNCTION reject_improvement_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'improvement plan events are append-only';
END;
$$;
CREATE TRIGGER improvement_events_append_only
  BEFORE UPDATE OR DELETE ON improvement_plan_events
  FOR EACH ROW EXECUTE FUNCTION reject_improvement_event_change();

ALTER TABLE improvement_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_plan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON improvement_plans
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON improvement_plan_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
