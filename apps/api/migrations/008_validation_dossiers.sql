CREATE TABLE validation_dossiers (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  intended_interpretation text NOT NULL,
  intended_population text NOT NULL,
  job_analysis_reference text NOT NULL,
  content_evidence_reference text NOT NULL,
  reliability_evidence_or_rationale text NOT NULL,
  criterion_evidence_or_rationale text NOT NULL,
  construct_evidence_or_rationale text NOT NULL,
  fairness_review_reference text NOT NULL,
  limitations text NOT NULL,
  revalidate_on date NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','REVIEWED','RETIRED')),
  created_by uuid NOT NULL,
  reviewed_by uuid,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,template_id,version),
  FOREIGN KEY (tenant_id,template_id) REFERENCES templates(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,reviewed_by) REFERENCES users(tenant_id,id)
);
CREATE UNIQUE INDEX validation_dossiers_one_reviewed ON validation_dossiers(tenant_id,template_id) WHERE state='REVIEWED';
CREATE INDEX validation_dossiers_template ON validation_dossiers(tenant_id,template_id,state,revalidate_on);
ALTER TABLE validation_dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON validation_dossiers
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE evaluations ADD COLUMN validation_dossier_id uuid;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_validation_dossier_fk
  FOREIGN KEY (tenant_id,validation_dossier_id) REFERENCES validation_dossiers(tenant_id,id);
