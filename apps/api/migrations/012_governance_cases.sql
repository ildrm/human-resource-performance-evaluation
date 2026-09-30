CREATE TABLE governance_cases (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('ETHICS','FRAUD','REGULATORY','SAFETY','SECURITY')),
  occurred_on date NOT NULL,
  description text NOT NULL,
  initial_evidence_reference text NOT NULL,
  status text NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED','TRIAGED','CONFIRMED','REJECTED','RESOLVED')),
  reported_by uuid NOT NULL,
  triaged_by uuid,
  decided_by uuid,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  triaged_at timestamptz,
  decided_at timestamptz,
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,reported_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,triaged_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,decided_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,resolved_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX governance_cases_employee_status ON governance_cases(tenant_id,employee_id,status,created_at DESC);

CREATE TABLE governance_case_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TRIAGE','EMPLOYEE_RESPONSE','CONFIRM','REJECT','RESOLVE')),
  note text NOT NULL,
  evidence_reference text,
  policy_basis text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,case_id) REFERENCES governance_cases(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX governance_case_events_timeline ON governance_case_events(tenant_id,case_id,created_at,id);

CREATE FUNCTION reject_governance_event_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'governance case events are append-only';
END;
$$;
CREATE TRIGGER governance_events_append_only
  BEFORE UPDATE OR DELETE ON governance_case_events
  FOR EACH ROW EXECUTE FUNCTION reject_governance_event_change();

ALTER TABLE governance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON governance_cases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenant_scope ON governance_case_events
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
