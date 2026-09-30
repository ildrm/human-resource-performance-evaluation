import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Database, SqlClient } from "./db.js";
import type { Principal } from "./security.js";
import { WorkspaceService } from "./workspace.service.js";

describe("binary proportion evidence", () => {
  it("rejects inconsistent counts and saves a visible interval without changing the score", async () => {
    const pg = await PGlite.create();
    try {
      for (const name of [
        "001_core.sql",
        "002_review_actors.sql",
        "003_audit_payload.sql",
        "004_behavior_feedback.sql",
        "005_sessions.sql",
        "006_evidence_quality.sql",
        "007_goals.sql",
        "008_validation_dossiers.sql",
        "009_auth_throttle.sql",
        "010_development_actions.sql",
        "011_improvement_plans.sql",
        "012_governance_cases.sql",
        "013_append_only_records.sql",
        "014_context_records.sql",
        "015_proportion_measurement.sql",
        "016_organization_history.sql",
        "017_review_conflicts.sql",
        "018_review_discussion.sql",
        "019_result_provenance.sql",
        "020_appeal_amendments.sql",
        "021_person_snapshot.sql",
        "022_template_governance.sql",
        "023_outbox_worker.sql",
      ])
        await pg.exec(await readFile(resolve("migrations", name), "utf8"));
      const tenant = "11111111-1111-4111-8111-111111111111";
      const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await pg.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A')", [
        tenant,
      ]);
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'admin@example.test','Admin','test','TENANT_ADMIN')",
        [tenant, adminId],
      );
      const database = {
        tenant<T>(
          tenantId: string,
          fn: (client: SqlClient) => Promise<T>,
        ): Promise<T> {
          return pg.transaction(async (tx) => {
            await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
              tenantId,
            ]);
            return fn({
              query: async (sql: string, params?: unknown[]) => {
                const result = await tx.query(sql, params);
                return {
                  ...result,
                  rowCount: result.rows.length || result.affectedRows,
                };
              },
            } as unknown as SqlClient);
          });
        },
      } as Database;
      const service = new WorkspaceService(database);
      const admin: Principal = {
        tenantId: tenant,
        userId: adminId,
        employeeId: adminId,
        role: "TENANT_ADMIN",
        exp: Date.now() + 60000,
      };
      const job = (await service.createJob(admin, {
        name: "Synthetic inspector",
        family: "Synthetic",
        purpose: "Inspect independent units",
        approved: true,
      })) as { id: string };
      await expect(
        service.createMetric(admin, {
          code: "bad-percent",
          name: "Bad proportion",
          construct: "Conformance",
          unit: "items",
          measurementKind: "BINOMIAL_PROPORTION",
          direction: "HIGHER",
          rationale: "Synthetic test",
          limitations: "Synthetic only",
          controllability: "PARTIAL",
        }),
      ).rejects.toThrow();
      const metric = (await service.createMetric(admin, {
        code: "accepted",
        name: "Accepted units",
        construct: "Conformance",
        unit: "%",
        measurementKind: "BINOMIAL_PROPORTION",
        direction: "HIGHER",
        rationale: "Synthetic independent unit checks",
        limitations: "Small samples are uncertain",
        controllability: "PARTIAL",
      })) as { id: string };
      const employee = (await service.createPerson(admin, {
        name: "Inspector",
        email: "inspector@example.test",
        password: "long-unique-password",
        role: "EMPLOYEE",
        jobId: job.id,
      })) as { id: string };
      const validator = (await service.createPerson(admin, {
        name: "Scientific reviewer",
        email: "science@example.test",
        password: "long-unique-password",
        role: "CALIBRATOR",
      })) as { id: string };
      const approver = (await service.createPerson(admin, {
        name: "Independent approver",
        email: "approver@example.test",
        password: "long-unique-password",
        role: "HR_ADMIN",
      })) as { id: string };
      const template = (await service.createTemplate(admin, {
        jobId: job.id,
        name: "Synthetic percent",
        version: 1,
        effectiveFrom: "2026-01-01",
        scientificRationale:
          "Accepted unit proportion represents the inspector conformance task.",
        limitations:
          "Synthetic samples do not demonstrate empirical model validity.",
        dimensions: [
          {
            name: "Quality",
            weight: "1",
            metrics: [{ metricId: metric.id, weight: "1", required: true }],
          },
        ],
      })) as { id: string };
      await service.reviewTemplate(admin, template.id);
      await service.validateTemplate(
        {
          ...admin,
          userId: validator.id,
          employeeId: validator.id,
          role: "CALIBRATOR",
        },
        template.id,
        {
          validationNote:
            "Independent synthetic review of the expected percent calculation.",
          fixtureEvidenceReference:
            "Synthetic inspector proportion golden fixture",
        },
      );
      await service.approveTemplate(
        {
          ...admin,
          userId: approver.id,
          employeeId: approver.id,
          role: "HR_ADMIN",
        },
        template.id,
      );
      await service.activateTemplate(admin, template.id);
      await service.createTarget(admin, {
        metricId: metric.id,
        effectiveFrom: "2026-01-01",
        critical: "0",
        threshold: "50",
        target: "90",
        stretch: "100",
        anchors: [
          { actual: "0", score: "0" },
          { actual: "50", score: "50" },
          { actual: "100", score: "100" },
        ],
        reason: "Synthetic percent anchor",
      });
      const cycle = (await service.createCycle(admin, {
        name: "January",
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        purpose: "DEVELOPMENT",
      })) as { id: string };
      const observation = {
        employeeId: employee.id,
        metricId: metric.id,
        observedAt: "2026-01-12T12:00:00.000Z",
        value: "100",
        dataState: "OBSERVED",
        source: "Synthetic inspection log",
      };
      await expect(
        service.addEvidence(admin, {
          ...observation,
          numerator: "3",
          denominator: "4",
        }),
      ).rejects.toThrow("must match");
      await expect(
        service.addEvidence(admin, {
          ...observation,
          numerator: "3.5",
          denominator: "3.5",
        }),
      ).rejects.toThrow("integer");
      await expect(service.addEvidence(admin, observation)).rejects.toThrow(
        "require numerator",
      );
      const evidence = (await service.addEvidence(admin, {
        ...observation,
        numerator: "3",
        denominator: "3",
      })) as { id: string };
      await service.verifyEvidence(admin, evidence.id, true);
      const evaluation = (await service.calculateEvaluation(
        admin,
        employee.id,
        cycle.id,
      )) as {
        score: string;
        result_snapshot: {
          dimensions: {
            metrics: {
              proportionInterval: {
                lowerPercent: string;
                denominator: string;
              } | null;
            }[];
          }[];
        };
      };
      expect(evaluation.score).toBe("100.0000");
      const interval =
        evaluation.result_snapshot.dimensions[0]!.metrics[0]!
          .proportionInterval;
      expect(interval?.denominator).toBe("3");
      expect(Number(interval?.lowerPercent)).toBeLessThan(50);
    } finally {
      await pg.close();
    }
  });
});
