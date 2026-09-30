CREATE TABLE sessions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,token_hash),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX sessions_user_lookup ON sessions(tenant_id,user_id,expires_at);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
