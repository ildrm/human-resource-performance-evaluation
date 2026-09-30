import { Client } from "pg";
import { hashPassword } from "../src/security.js";

const url = process.env.MIGRATION_DATABASE_URL;
const password = process.env.SMOKE_PASSWORD;
if (!url || !password || password.length < 20)
  throw new Error(
    "Migration URL and a 20-character synthetic smoke password are required",
  );

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  for (const tenant of ["smoke-a", "smoke-b"] as const) {
    await client.query(
      "INSERT INTO tenants(slug,name) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING",
      [tenant, `Synthetic ${tenant}`],
    );
    const selected = await client.query<{ id: string }>(
      "SELECT id FROM tenants WHERE slug=$1",
      [tenant],
    );
    const tenantId = selected.rows[0]!.id;
    const email =
      tenant === "smoke-a" ? "admin-a@example.test" : "admin-b@example.test";
    await client.query(
      `INSERT INTO users(tenant_id,email,name,password_hash,role)
       VALUES ($1,$2,$3,$4,'TENANT_ADMIN')
       ON CONFLICT (tenant_id,email) DO UPDATE
       SET password_hash=excluded.password_hash,active=true,role='TENANT_ADMIN'`,
      [
        tenantId,
        email,
        `Synthetic ${tenant} administrator`,
        hashPassword(password),
      ],
    );
  }
  await client.query("COMMIT");
  process.stdout.write("Synthetic smoke administrators prepared\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
