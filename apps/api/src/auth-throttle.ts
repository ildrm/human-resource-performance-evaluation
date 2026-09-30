import { createHmac } from "node:crypto";
import type { SqlClient } from "./db.js";

export function loginAttemptKey(
  tenant: string,
  email: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${tenant.toLowerCase()}\0${email.toLowerCase()}`)
    .digest("hex");
}

export async function loginBlocked(
  client: SqlClient,
  keyHash: string,
): Promise<boolean> {
  const row = await client.query<{ blocked: boolean }>(
    "SELECT locked_until>now() AS blocked FROM auth_attempts WHERE key_hash=$1",
    [keyHash],
  );
  return row.rows[0]?.blocked ?? false;
}

export async function recordLoginFailure(
  client: SqlClient,
  keyHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO auth_attempts(key_hash,failure_count,window_started_at) VALUES ($1,1,now())
     ON CONFLICT (key_hash) DO UPDATE SET
       failure_count=CASE WHEN auth_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE auth_attempts.failure_count+1 END,
       window_started_at=CASE WHEN auth_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE auth_attempts.window_started_at END,
       locked_until=CASE WHEN auth_attempts.window_started_at<now()-interval '15 minutes' THEN NULL WHEN auth_attempts.failure_count+1>=10 THEN now()+interval '15 minutes' ELSE auth_attempts.locked_until END,
       updated_at=now()`,
    [keyHash],
  );
}

export async function clearLoginFailures(
  client: SqlClient,
  keyHash: string,
): Promise<void> {
  await client.query("DELETE FROM auth_attempts WHERE key_hash=$1", [keyHash]);
}

export async function cleanupLoginFailures(client: SqlClient): Promise<number> {
  const result = await client.query(
    "DELETE FROM auth_attempts WHERE updated_at<now()-interval '1 day'",
  );
  return result.rowCount ?? 0;
}
