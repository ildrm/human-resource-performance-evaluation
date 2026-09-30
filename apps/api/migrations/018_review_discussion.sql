CREATE TABLE review_messages (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL,
  author_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SHARED','INTERNAL')),
  topic text NOT NULL CHECK (topic IN ('REVIEW','CALIBRATION','APPEAL')),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 10 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,evaluation_id) REFERENCES evaluations(tenant_id,id),
  FOREIGN KEY (tenant_id,author_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX review_messages_thread ON review_messages(tenant_id,evaluation_id,created_at,id);
CREATE TRIGGER review_messages_append_only BEFORE UPDATE OR DELETE ON review_messages FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
ALTER TABLE review_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON review_messages USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
