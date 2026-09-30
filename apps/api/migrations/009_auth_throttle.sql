-- Pre-authentication counters contain only a keyed digest, never an email or IP address.
-- This is deliberately outside tenant RLS because the tenant may not exist yet at login.
CREATE TABLE auth_attempts (
  key_hash text PRIMARY KEY CHECK (length(key_hash)=64),
  failure_count integer NOT NULL CHECK (failure_count > 0),
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempts_cleanup ON auth_attempts(updated_at);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hpi_app') THEN
    GRANT DELETE ON auth_attempts TO hpi_app;
  END IF;
END $$;
