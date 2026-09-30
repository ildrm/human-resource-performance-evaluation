import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Database, SqlClient } from "./db.js";
import { ImprovementService } from "./improvement.service.js";
import { PrivacyService } from "./privacy.service.js";
import type { Principal } from "./security.js";

describe("controlled improvement plan workflow", () => {
  it("requires a published administrative source, an independent decision, employee response, and appeal review", async () => {
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
      const otherTenant = "22222222-2222-4222-8222-222222222222";
      const managerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const employeeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const hrId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const independentHrId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const outsiderId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const foreignId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      const jobId = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const templateId = "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const administrativeCycle = "33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const secondAdministrativeCycle = "88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const developmentCycle = "44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const publishedEvaluation = "55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const draftEvaluation = "66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const developmentEvaluation = "77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const today = new Date().toISOString().slice(0, 10);
      const endsOn = new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10);
      await pg.query(
        "INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A'),($2,'b','B')",
        [tenant, otherTenant],
      );
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'manager@example.test','Manager','test','MANAGER'),($1,$3,'employee@example.test','Employee','test','EMPLOYEE'),($1,$4,'hr@example.test','HR','test','HR_ADMIN'),($1,$5,'other-hr@example.test','Other HR','test','HR_ADMIN'),($1,$6,'outsider@example.test','Outsider','test','MANAGER'),($7,$8,'foreign@example.test','Foreign','test','TENANT_ADMIN')",
        [
          tenant,
          managerId,
          employeeId,
          hrId,
          independentHrId,
          outsiderId,
          otherTenant,
          foreignId,
        ],
      );
      await pg.query(
        "UPDATE users SET manager_id=$2 WHERE tenant_id=$1 AND id=$3",
        [tenant, managerId, employeeId],
      );
      await pg.query(
        "INSERT INTO jobs(tenant_id,id,name,family,purpose,version,approved) VALUES ($1,$2,'Technician','Operations','Synthetic task',1,true)",
        [tenant, jobId],
      );
      await pg.query(
        "INSERT INTO templates(tenant_id,id,job_id,name,version,effective_from,dimensions,state) VALUES ($1,$2,$3,'Review',1,'2026-01-01','[]'::jsonb,'ACTIVE')",
        [tenant, templateId, jobId],
      );
      await pg.query(
        "INSERT INTO cycles(tenant_id,id,name,starts_on,ends_on,purpose) VALUES ($1,$2,'Administrative','2026-01-01','2026-12-31','ADMINISTRATIVE'),($1,$3,'Development','2026-01-01','2026-12-31','DEVELOPMENT'),($1,$4,'Second administrative','2026-01-01','2026-12-31','ADMINISTRATIVE')",
        [
          tenant,
          administrativeCycle,
          developmentCycle,
          secondAdministrativeCycle,
        ],
      );
      await pg.query(
        "INSERT INTO evaluations(tenant_id,id,employee_id,cycle_id,template_id,status,input_snapshot,result_snapshot,submitted_by,published_by) VALUES ($1,$2,$3,$4,$5,'PUBLISHED','{}'::jsonb,'{}'::jsonb,$6,$7),($1,$8,$3,$11,$5,'CALCULATED','{}'::jsonb,'{}'::jsonb,NULL,NULL),($1,$9,$3,$10,$5,'PUBLISHED','{}'::jsonb,'{}'::jsonb,$6,$7)",
        [
          tenant,
          publishedEvaluation,
          employeeId,
          administrativeCycle,
          templateId,
          managerId,
          hrId,
          draftEvaluation,
          developmentEvaluation,
          developmentCycle,
          secondAdministrativeCycle,
        ],
      );
      const db = {
        tenant<T>(
          id: string,
          fn: (client: SqlClient) => Promise<T>,
        ): Promise<T> {
          return pg.transaction(async (tx) => {
            await tx.query("SELECT set_config('app.tenant_id',$1,true)", [id]);
            const client = {
              query: async (sql: string, params?: unknown[]) => {
                const result = await tx.query(sql, params);
                return {
                  ...result,
                  rowCount: result.rows.length || result.affectedRows,
                };
              },
            } as unknown as SqlClient;
            return fn(client);
          });
        },
      } as Database;
      const principal = (
        userId: string,
        role: Principal["role"],
        tenantId = tenant,
      ): Principal => ({
        tenantId,
        userId,
        role,
        employeeId: userId,
        exp: Date.now() + 10000,
      });
      const manager = principal(managerId, "MANAGER");
      const employee = principal(employeeId, "EMPLOYEE");
      const hr = principal(hrId, "HR_ADMIN");
      const independentHr = principal(independentHrId, "HR_ADMIN");
      const outsider = principal(outsiderId, "MANAGER");
      const service = new ImprovementService(db);
      const fields = {
        employeeId,
        sourceEvaluationId: publishedEvaluation,
        gap: "Documented shortfall in an essential role task",
        expectedStandard: "Complete the documented task to the role standard",
        supportingEvidence: "Published administrative evaluation and task log",
        requiredImprovement: "Demonstrate the documented task without errors",
        supportProvided: "Protected practice time and supervisor coaching",
        measurementCriteria: "Two observed demonstrations meeting the standard",
        startsOn: today,
        endsOn,
      };
      await expect(
        service.create(manager, {
          ...fields,
          sourceEvaluationId: draftEvaluation,
        }),
      ).rejects.toThrow("published administrative evaluation");
      await expect(
        service.create(manager, {
          ...fields,
          sourceEvaluationId: developmentEvaluation,
        }),
      ).rejects.toThrow("published administrative evaluation");
      await expect(service.create(outsider, fields)).rejects.toThrow(
        "outside access scope",
      );
      const plan = (await service.create(manager, fields)) as {
        id: string;
        status: string;
      };
      expect(plan.status).toBe("DRAFT");
      expect(
        ((await service.list(employee, employeeId)) as { plans: unknown[] })
          .plans,
      ).toHaveLength(0);
      await expect(service.detail(employee, plan.id)).rejects.toThrow(
        "outside access scope",
      );
      await expect(
        service.detail(
          principal(foreignId, "TENANT_ADMIN", otherTenant),
          plan.id,
        ),
      ).rejects.toThrow("not found");
      expect(
        (
          (await new PrivacyService(db).exportMine(employee)) as {
            improvementPlans: unknown[];
          }
        ).improvementPlans,
      ).toHaveLength(0);
      await expect(
        service.record(manager, plan.id, {
          kind: "ACTIVATED",
          note: "Manager attempted to approve their own plan",
        }),
      ).rejects.toThrow("Insufficient permission");
      await service.record(hr, plan.id, {
        kind: "ACTIVATED",
        note: "Independent HR review approved the documented plan",
      });
      await expect(
        service.record(hr, plan.id, {
          kind: "DECISION",
          note: "Tried to decide without employee input or review",
          outcome: "NOT_MET",
          evidenceReference: "Task log record 12",
        }),
      ).rejects.toThrow("employee response and a review meeting");
      await service.record(employee, plan.id, {
        kind: "EMPLOYEE_RESPONSE",
        note: "I understand the standard and request coaching time",
      });
      await service.record(manager, plan.id, {
        kind: "SUPPORT_UPDATE",
        note: "Coaching time was scheduled for the next shift",
      });
      await expect(
        service.record(manager, plan.id, {
          kind: "REVIEW_MEETING",
          note: "Recorded an invalid future review meeting",
          occurredOn: new Date(Date.now() + 40 * 86400000)
            .toISOString()
            .slice(0, 10),
        }),
      ).rejects.toThrow("Meeting date");
      await service.record(manager, plan.id, {
        kind: "REVIEW_MEETING",
        note: "Supervisor reviewed the observed task demonstration",
        occurredOn: today,
        evidenceReference: "Task log record 12",
      });
      await expect(
        service.record(manager, plan.id, {
          kind: "DECISION",
          note: "Manager attempted to decide their own plan",
          outcome: "NOT_MET",
          evidenceReference: "Task log record 12",
        }),
      ).rejects.toThrow("Insufficient permission");
      await service.record(hr, plan.id, {
        kind: "DECISION",
        note: "HR reviewed the response, meeting, and task evidence",
        outcome: "NOT_MET",
        evidenceReference: "Task log record 12",
      });
      await service.record(employee, plan.id, {
        kind: "APPEAL",
        note: "Please review additional context from the next shift",
      });
      await expect(
        service.record(hr, plan.id, {
          kind: "APPEAL_RESOLUTION",
          note: "Deciding actor attempted to resolve the appeal",
          outcome: "MET",
          evidenceReference: "Additional task log 13",
        }),
      ).rejects.toThrow("independent HR actor");
      await service.record(independentHr, plan.id, {
        kind: "APPEAL_RESOLUTION",
        note: "Independent review accepted the additional evidence",
        outcome: "MET",
        evidenceReference: "Additional task log 13",
      });
      const detail = (await service.detail(employee, plan.id)) as {
        status: string;
        decision: string;
        final_decision: string;
        events: { kind: string }[];
      };
      expect(detail.status).toBe("CLOSED");
      expect(detail.decision).toBe("NOT_MET");
      expect(detail.final_decision).toBe("MET");
      expect(detail.events.map((event) => event.kind)).toEqual([
        "ACTIVATED",
        "EMPLOYEE_RESPONSE",
        "SUPPORT_UPDATE",
        "REVIEW_MEETING",
        "DECISION",
        "APPEAL",
        "APPEAL_RESOLUTION",
      ]);
      const copy = (await new PrivacyService(db).exportMine(employee)) as {
        improvementPlans: { id: string }[];
        improvementEvents: { plan_id: string }[];
      };
      expect(copy.improvementPlans.map((item) => item.id)).toEqual([plan.id]);
      expect(copy.improvementEvents).toHaveLength(7);
      await expect(
        pg.query(
          "UPDATE improvement_plan_events SET note='changed' WHERE plan_id=$1",
          [plan.id],
        ),
      ).rejects.toThrow("append-only");
    } finally {
      await pg.close();
    }
  }, 60000);
});
