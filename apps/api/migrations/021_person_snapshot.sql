ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS person_snapshot jsonb;
COMMENT ON COLUMN evaluations.person_snapshot IS
  'Frozen employee name, job assignment, and manager at calculation time. NULL means the legacy evaluation did not preserve these fields.';
CREATE INDEX IF NOT EXISTS evaluations_report_page
  ON evaluations(tenant_id,cycle_id,id DESC);
