import { Client } from "pg";
import { hashPassword } from "../src/security.js";

const {
  MIGRATION_DATABASE_URL,
  BOOTSTRAP_TENANT,
  BOOTSTRAP_NAME,
  BOOTSTRAP_EMAIL,
  BOOTSTRAP_PASSWORD,
} = process.env;
if (
  !MIGRATION_DATABASE_URL ||
  !BOOTSTRAP_TENANT ||
  !BOOTSTRAP_NAME ||
  !BOOTSTRAP_EMAIL ||
  !BOOTSTRAP_PASSWORD ||
  BOOTSTRAP_PASSWORD.length < 12
)
  throw new Error(
    "Set migration URL and BOOTSTRAP_* values; password must be at least 12 characters",
  );
const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const tenant = await client.query<{ id: string }>(
    "INSERT INTO tenants(slug,name) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET name=excluded.name RETURNING id",
    [BOOTSTRAP_TENANT, BOOTSTRAP_NAME],
  );
  const tenantId = tenant.rows[0]!.id;
  await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  await client.query(
    "INSERT INTO users(tenant_id,email,name,password_hash,role) VALUES ($1,$2,$3,$4,'TENANT_ADMIN') ON CONFLICT (tenant_id,email) DO NOTHING",
    [
      tenantId,
      BOOTSTRAP_EMAIL.toLowerCase(),
      "Tenant administrator",
      hashPassword(BOOTSTRAP_PASSWORD),
    ],
  );
  await client.query("COMMIT");
  process.stdout.write(`Bootstrap tenant ${BOOTSTRAP_TENANT} ready\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
