import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(19092026)");
  const migrationDir = resolve("migrations");
  const migrations = (await readdir(migrationDir))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (migrations[0] !== "001_core.sql")
    throw new Error("Core migration is missing");
  for (const name of migrations) {
    const version = name.slice(0, -4);
    const exists = await client.query("SELECT to_regclass($1) AS name", [
      "public.schema_migrations",
    ]);
    const applied = exists.rows[0]?.name
      ? await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
          version,
        ])
      : { rowCount: 0 };
    if (applied.rowCount) continue;
    await client.query(await readFile(resolve(migrationDir, name), "utf8"));
    await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
      version,
    ]);
  }
  const checksumColumn = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='schema_migrations' AND column_name='checksum'",
  );
  if (checksumColumn.rowCount) {
    for (const name of migrations) {
      const version = name.slice(0, -4);
      const source = await readFile(resolve(migrationDir, name));
      const checksum = createHash("sha256").update(source).digest("hex");
      const recorded = await client.query<{ checksum: string | null }>(
        "SELECT checksum FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (recorded.rows[0]?.checksum && recorded.rows[0].checksum !== checksum)
        throw new Error(
          `Applied migration ${version} differs from its recorded checksum`,
        );
      await client.query(
        "UPDATE schema_migrations SET checksum=$2 WHERE version=$1 AND checksum IS NULL",
        [version, checksum],
      );
    }
  }
  const password = process.env.HPI_APP_PASSWORD;
  if (password) {
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      ["hpi_app"],
    );
    if (!role.rowCount) await client.query("CREATE ROLE hpi_app LOGIN");
    await client.query(
      "ALTER ROLE hpi_app PASSWORD " + client.escapeLiteral(password),
    );
    const database = await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database.rows[0]!.name)} TO hpi_app`,
    );
    await client.query("GRANT USAGE ON SCHEMA public TO hpi_app");
    await client.query(
      "GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO hpi_app",
    );
    await client.query("GRANT DELETE ON auth_attempts TO hpi_app");
    await client.query(
      "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hpi_app",
    );
  }
  await client.query("COMMIT");
  process.stdout.write("Migrations applied\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
