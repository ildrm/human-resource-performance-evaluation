import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("core migration and tenant isolation in embedded PostgreSQL", () => {
  it("applies the SQL and rejects cross-tenant reads and writes for a non-owner role", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(await readFile(resolve("migrations/001_core.sql"), "utf8"));
      await db.exec(
        await readFile(resolve("migrations/002_review_actors.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/003_audit_payload.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/004_behavior_feedback.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/005_sessions.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/006_evidence_quality.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/007_goals.sql"), "utf8"),
      );
      await db.exec(
        await readFile(
          resolve("migrations/008_validation_dossiers.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(resolve("migrations/009_auth_throttle.sql"), "utf8"),
      );
      await db.exec(
        await readFile(
          resolve("migrations/010_development_actions.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(resolve("migrations/011_improvement_plans.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/012_governance_cases.sql"), "utf8"),
      );
      await db.exec(
        await readFile(
          resolve("migrations/013_append_only_records.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(resolve("migrations/014_context_records.sql"), "utf8"),
      );
      await db.exec(
        await readFile(
          resolve("migrations/015_proportion_measurement.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(
          resolve("migrations/016_organization_history.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(resolve("migrations/017_review_conflicts.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/018_review_discussion.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/019_result_provenance.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/020_appeal_amendments.sql"), "utf8"),
      );
      await db.exec(
        await readFile(resolve("migrations/021_person_snapshot.sql"), "utf8"),
      );
      await db.exec(
        await readFile(
          resolve("migrations/022_template_governance.sql"),
          "utf8",
        ),
      );
      await db.exec(
        await readFile(resolve("migrations/023_outbox_worker.sql"), "utf8"),
      );
      const a = "11111111-1111-4111-8111-111111111111";
      const b = "22222222-2222-4222-8222-222222222222";
      await db.query(
        "INSERT INTO tenants(id,slug,name) VALUES ($1,$2,$3),($4,$5,$6)",
        [a, "a", "Tenant A", b, "b", "Tenant B"],
      );
      await db.query(
        "INSERT INTO users(tenant_id,email,name,password_hash,role) VALUES ($1,'a@example.test','Alice','test','EMPLOYEE'),($2,'b@example.test','Bob','test','EMPLOYEE')",
        [a, b],
      );
      const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await db.query(
        "INSERT INTO jobs(tenant_id,id,name,family,purpose,version,approved) VALUES ($1,$3,'A job','A','A purpose',1,true),($2,$4,'B job','B','B purpose',1,true)",
        [a, b, jobA, jobB],
      );
      const people = await db.query<{ tenant_id: string; id: string }>(
        "SELECT tenant_id,id FROM users",
      );
      const userA = people.rows.find((person) => person.tenant_id === a)!.id;
      const userB = people.rows.find((person) => person.tenant_id === b)!.id;
      await db.query(
        "INSERT INTO behavior_scales(tenant_id,job_id,name,version,job_analysis_reference,development_method,limitations,anchors,created_by) VALUES ($1,$3,'A scale',1,'reference','method','limits','[]',$5),($2,$4,'B scale',1,'reference','method','limits','[]',$6)",
        [a, b, jobA, jobB, userA, userB],
      );
      await db.query(
        "INSERT INTO sessions(tenant_id,token_hash,user_id,expires_at) VALUES ($1,$3,$5,now() + interval '1 hour'),($2,$4,$6,now() + interval '1 hour')",
        [a, b, "a".repeat(64), "b".repeat(64), userA, userB],
      );
      await db.exec(
        "CREATE ROLE hpi_test NOLOGIN; GRANT USAGE ON SCHEMA public TO hpi_test; GRANT SELECT,INSERT ON users TO hpi_test; GRANT SELECT ON tenants,behavior_scales,sessions TO hpi_test;",
      );
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE hpi_test");
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [a]);
        const rows = await tx.query<{ email: string }>(
          "SELECT email FROM users ORDER BY email",
        );
        expect(rows.rows.map((row) => row.email)).toEqual(["a@example.test"]);
        const scales = await tx.query<{ name: string }>(
          "SELECT name FROM behavior_scales",
        );
        expect(scales.rows.map((row) => row.name)).toEqual(["A scale"]);
        const sessions = await tx.query<{ token_hash: string }>(
          "SELECT token_hash FROM sessions",
        );
        expect(sessions.rows.map((row) => row.token_hash)).toEqual([
          "a".repeat(64),
        ]);
        await tx.exec("SAVEPOINT cross_tenant");
        await expect(
          tx.query(
            "INSERT INTO users(tenant_id,email,name,password_hash,role) VALUES ($1,'intruder@example.test','Intruder','test','EMPLOYEE')",
            [b],
          ),
        ).rejects.toThrow();
        await tx.exec("ROLLBACK TO SAVEPOINT cross_tenant");
      });
      await db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE hpi_test");
        await tx.query("SELECT set_config('app.tenant_id',$1,true)", [b]);
        const rows = await tx.query<{ email: string }>(
          "SELECT email FROM users ORDER BY email",
        );
        expect(rows.rows.map((row) => row.email)).toEqual(["b@example.test"]);
        const scales = await tx.query<{ name: string }>(
          "SELECT name FROM behavior_scales",
        );
        expect(scales.rows.map((row) => row.name)).toEqual(["B scale"]);
        const sessions = await tx.query<{ token_hash: string }>(
          "SELECT token_hash FROM sessions",
        );
        expect(sessions.rows.map((row) => row.token_hash)).toEqual([
          "b".repeat(64),
        ]);
      });
    } finally {
      await db.close();
    }
  }, 30000);
});
