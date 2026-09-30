ALTER TABLE outbox ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'PENDING'
  CHECK (delivery_state IN ('PENDING','DELIVERED','NO_SUBSCRIBERS','DEAD_LETTER'));
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS locked_until timestamptz;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
CREATE INDEX IF NOT EXISTS outbox_available
  ON outbox(tenant_id,available_at,created_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  event_id uuid NOT NULL,
  kind text NOT NULL,
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,event_id,recipient_id),
  FOREIGN KEY (tenant_id,recipient_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,event_id) REFERENCES outbox(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient
  ON notifications(tenant_id,recipient_id,created_at DESC,id DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON notifications
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
