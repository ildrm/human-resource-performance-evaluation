ALTER TABLE evaluations ADD COLUMN submitted_by uuid;
ALTER TABLE evaluations ADD COLUMN published_by uuid;

UPDATE evaluations e
SET submitted_by = (
  SELECT a.actor_id FROM audit_events a
  WHERE a.tenant_id = e.tenant_id
    AND a.object_id = e.id
    AND a.object_type = 'evaluation'
    AND a.action = 'EvaluationSubmitted'
  ORDER BY a.id DESC LIMIT 1
)
WHERE e.status IN ('SUBMITTED','PUBLISHED','ACKNOWLEDGED','APPEALED');

UPDATE evaluations e
SET published_by = (
  SELECT a.actor_id FROM audit_events a
  WHERE a.tenant_id = e.tenant_id
    AND a.object_id = e.id
    AND a.object_type = 'evaluation'
    AND a.action = 'EvaluationPublished'
  ORDER BY a.id DESC LIMIT 1
)
WHERE e.status IN ('PUBLISHED','ACKNOWLEDGED','APPEALED');

ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_submitted_by_fk
  FOREIGN KEY (tenant_id,submitted_by) REFERENCES users(tenant_id,id);
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_published_by_fk
  FOREIGN KEY (tenant_id,published_by) REFERENCES users(tenant_id,id);
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_submission_actor_required
  CHECK (status NOT IN ('SUBMITTED','PUBLISHED','ACKNOWLEDGED','APPEALED') OR submitted_by IS NOT NULL);
ALTER TABLE evaluations
  ADD CONSTRAINT evaluations_publication_actor_required
  CHECK (status NOT IN ('PUBLISHED','ACKNOWLEDGED','APPEALED') OR published_by IS NOT NULL);
