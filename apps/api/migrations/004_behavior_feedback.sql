CREATE TABLE behavior_scales (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  job_analysis_reference text NOT NULL,
  development_method text NOT NULL,
  limitations text NOT NULL,
  anchors jsonb NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')),
  created_by uuid NOT NULL,
  approved_by uuid,
  approval_reference text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,job_id,name,version),
  FOREIGN KEY (tenant_id,job_id) REFERENCES jobs(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,approved_by) REFERENCES users(tenant_id,id)
);

CREATE TABLE feedback_campaigns (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  scale_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('DEVELOPMENT','ADMINISTRATIVE')),
  relationship_weights jsonb NOT NULL,
  minimum_respondents integer NOT NULL CHECK (minimum_respondents BETWEEN 3 AND 20),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLOSED')),
  created_by uuid NOT NULL,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,employee_id,cycle_id,scale_id),
  FOREIGN KEY (tenant_id,employee_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,cycle_id) REFERENCES cycles(tenant_id,id),
  FOREIGN KEY (tenant_id,scale_id) REFERENCES behavior_scales(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,closed_by) REFERENCES users(tenant_id,id)
);

CREATE TABLE feedback_invitations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL,
  respondent_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('MANAGER','PEER','DIRECT_REPORT','PROJECT_LEADER','MATRIX_MANAGER','INTERNAL_CUSTOMER','EXTERNAL_STAKEHOLDER','SELF')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,campaign_id,respondent_id),
  FOREIGN KEY (tenant_id,campaign_id) REFERENCES feedback_campaigns(tenant_id,id),
  FOREIGN KEY (tenant_id,respondent_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE feedback_ratings (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  campaign_id uuid NOT NULL,
  respondent_id uuid NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 5),
  observed_example text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,campaign_id,respondent_id),
  FOREIGN KEY (tenant_id,campaign_id,respondent_id)
    REFERENCES feedback_invitations(tenant_id,campaign_id,respondent_id)
);

CREATE INDEX feedback_assignments_lookup ON feedback_invitations(tenant_id,respondent_id);
CREATE INDEX feedback_ratings_campaign_lookup ON feedback_ratings(tenant_id,campaign_id);

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['behavior_scales','feedback_campaigns','feedback_invitations','feedback_ratings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name);
  END LOOP;
END $$;
