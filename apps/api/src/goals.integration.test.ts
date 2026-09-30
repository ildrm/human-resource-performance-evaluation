import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Database, SqlClient } from "./db.js";
import { GoalsService } from "./goals.service.js";
import { DevelopmentService } from "./development.service.js";
import { PrivacyService } from "./privacy.service.js";
import type { Principal } from "./security.js";
import { WorkspaceService } from "./workspace.service.js";

describe("prospective goal and check-in workflow", () => {
  it("preserves goal history, purpose separation, and employee access scope", async () => {
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
      const tenantId = "11111111-1111-4111-8111-111111111111";
      const otherTenant = "22222222-2222-4222-8222-222222222222";
      const managerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const employeeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const outsiderId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const otherTenantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const developmentCycle = "11111111-2222-4333-8444-555555555555";
      const administrativeCycle = "22222222-3333-4444-8555-666666666666";
      const expiredCycle = "33333333-4444-4555-8666-777777777777";
      const startsOn = new Date(Date.now() - 86400000)
        .toISOString()
        .slice(0, 10);
      const endsOn = new Date(Date.now() + 365 * 86400000)
        .toISOString()
        .slice(0, 10);
      const dueDate = new Date(Date.now() + 120 * 86400000)
        .toISOString()
        .slice(0, 10);
      const expiredOn = new Date(Date.now() - 2 * 86400000)
        .toISOString()
        .slice(0, 10);
      await pg.query(
        "INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A'),($2,'b','B')",
        [tenantId, otherTenant],
      );
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'manager@example.test','Manager','test','MANAGER'),($1,$3,'employee@example.test','Employee','test','EMPLOYEE'),($1,$4,'outsider@example.test','Outsider','test','MANAGER'),($5,$6,'other@example.test','Other','test','TENANT_ADMIN')",
        [
          tenantId,
          managerId,
          employeeId,
          outsiderId,
          otherTenant,
          otherTenantId,
        ],
      );
      await pg.query(
        "UPDATE users SET manager_id=$2 WHERE tenant_id=$1 AND id=$3",
        [tenantId, managerId, employeeId],
      );
      await pg.query(
        "INSERT INTO cycles(tenant_id,id,name,starts_on,ends_on,purpose) VALUES ($1,$2,'Development',$5,$6,'DEVELOPMENT'),($1,$3,'Administrative',$5,$6,'ADMINISTRATIVE'),($1,$4,'Expired',$7,$5,'DEVELOPMENT')",
        [
          tenantId,
          developmentCycle,
          administrativeCycle,
          expiredCycle,
          startsOn,
          endsOn,
          expiredOn,
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
      const service = new GoalsService(db);
      const principal = (
        userId: string,
        role: Principal["role"],
        id = tenantId,
      ): Principal => ({
        tenantId: id,
        userId,
        role,
        employeeId: userId,
        exp: Date.now() + 10000,
      });
      const manager = principal(managerId, "MANAGER");
      const employee = principal(employeeId, "EMPLOYEE");
      const outsider = principal(outsiderId, "MANAGER");
      const visibleCatalog = (await new WorkspaceService(db).catalog(
        manager,
      )) as { users: { id: string }[] };
      expect(
        visibleCatalog.users.some((person) => person.id === employeeId),
      ).toBe(true);
      const restrictedCatalog = (await new WorkspaceService(db).catalog(
        outsider,
      )) as { users: { id: string }[] };
      expect(
        restrictedCatalog.users.some((person) => person.id === employeeId),
      ).toBe(false);
      const fields = {
        description: "Complete documented role-specific safety training",
        baseline: "Training not yet completed",
        threshold: "Attend the initial safety session",
        target: "Pass the documented safety assessment",
        stretch: "Lead one documented peer walkthrough",
        dueDate,
        priority: "HIGH",
        weight: "0.25",
        reviewCadence: "MONTHLY",
        dependencies: [],
        status: "ACTIVE",
        reason: "Agreed learning objective for the review cycle",
      };
      const created = (await service.create(manager, {
        ...fields,
        employeeId,
        cycleId: developmentCycle,
        kind: "LEARNING",
      })) as { id: string; purpose: string };
      expect(created.purpose).toBe("DEVELOPMENT");
      await expect(
        service.create(manager, {
          ...fields,
          employeeId,
          cycleId: expiredCycle,
          kind: "LEARNING",
        }),
      ).rejects.toThrow("after the cycle ends");
      await expect(
        service.create(manager, {
          ...fields,
          dueDate: new Date(Date.now() + 400 * 86400000)
            .toISOString()
            .slice(0, 10),
          employeeId,
          cycleId: developmentCycle,
          kind: "LEARNING",
        }),
      ).rejects.toThrow("inside the cycle");
      await expect(
        service.create(employee, {
          ...fields,
          employeeId,
          cycleId: administrativeCycle,
          kind: "PERFORMANCE",
        }),
      ).rejects.toThrow("Insufficient permission");
      await expect(service.detail(outsider, created.id)).rejects.toThrow(
        "outside access scope",
      );
      await expect(
        service.detail(
          principal(otherTenantId, "TENANT_ADMIN", otherTenant),
          created.id,
        ),
      ).rejects.toThrow("not found");
      const future = new Date(Date.now() + 3600000).toISOString();
      await expect(
        service.revise(employee, created.id, {
          ...fields,
          expectedVersion: 1,
          effectiveAt: future,
        }),
      ).rejects.toThrow("Insufficient permission");
      await expect(
        service.revise(manager, created.id, {
          ...fields,
          expectedVersion: 1,
          effectiveAt: new Date(Date.now() - 3600000).toISOString(),
        }),
      ).rejects.toThrow("prospectively");
      const revised = (await service.revise(manager, created.id, {
        ...fields,
        target: "Pass the revised documented assessment",
        expectedVersion: 1,
        effectiveAt: future,
        reason: "Training provider changed the assessment prospectively",
      })) as { version: number };
      expect(revised.version).toBe(2);
      await expect(
        service.revise(manager, created.id, {
          ...fields,
          expectedVersion: 1,
          effectiveAt: new Date(Date.now() + 7200000).toISOString(),
        }),
      ).rejects.toThrow("version changed");
      await service.checkin(employee, created.id, {
        progress: "I attended the initial safety session this week",
        nextAction: "Complete the documented assessment",
        supportNeeded: "Protected study time",
      });
      const detail = (await service.detail(employee, created.id)) as {
        purpose: string;
        revisions: { target: string }[];
        checkins: { progress: string }[];
      };
      expect(detail.purpose).toBe("DEVELOPMENT");
      expect(detail.revisions).toHaveLength(2);
      expect(detail.revisions[0]!.target).toBe(fields.target);
      expect(detail.checkins).toHaveLength(1);
      const development = new DevelopmentService(db);
      const actionFields = {
        employeeId,
        cycleId: developmentCycle,
        goalId: created.id,
        competencyGap: "Needs to demonstrate the documented safety procedure",
        currentLevel: "Can describe the procedure with support",
        targetLevel: "Can independently demonstrate the procedure",
        activity:
          "Practice and demonstrate the safety procedure to the supervisor",
        training: "Role-specific safety training",
        mentorId: managerId,
        stretchAssignment: "Walk a peer through the procedure",
        dueDate,
      };
      await expect(
        development.create(manager, {
          ...actionFields,
          cycleId: administrativeCycle,
          goalId: undefined,
        }),
      ).rejects.toThrow("development cycle");
      await expect(development.create(outsider, actionFields)).rejects.toThrow(
        "outside access scope",
      );
      const action = (await development.create(manager, actionFields)) as {
        id: string;
        status: string;
      };
      expect(action.status).toBe("PLANNED");
      await expect(development.detail(outsider, action.id)).rejects.toThrow(
        "outside access scope",
      );
      await expect(
        development.recordEvent(employee, action.id, {
          kind: "COMPLETED",
          note: "I completed the training and demonstration",
          evidenceReference: "Training record 123",
        }),
      ).rejects.toThrow("Insufficient permission");
      await development.recordEvent(employee, action.id, {
        kind: "PROGRESS",
        note: "Completed the first documented training session",
      });
      await development.recordEvent(manager, action.id, {
        kind: "REVIEW",
        note: "Supervisor observed a successful practice session",
      });
      await expect(
        development.recordEvent(manager, action.id, {
          kind: "COMPLETED",
          note: "Supervisor confirmed the target level was met",
        }),
      ).rejects.toThrow("evidence reference");
      await development.recordEvent(manager, action.id, {
        kind: "COMPLETED",
        note: "Supervisor confirmed the target level was met",
        evidenceReference: "Training record 123",
      });
      const actionDetail = (await development.detail(employee, action.id)) as {
        status: string;
        events: { kind: string }[];
      };
      expect(actionDetail.status).toBe("COMPLETED");
      expect(actionDetail.events.map((event) => event.kind)).toEqual([
        "PROGRESS",
        "REVIEW",
        "COMPLETED",
      ]);
      await expect(
        development.recordEvent(manager, action.id, {
          kind: "REVIEW",
          note: "Tried to alter a closed action",
        }),
      ).rejects.toThrow("Closed development actions");
      const list = (await service.list(employee, employeeId)) as {
        goals: { version: number }[];
      };
      expect(list.goals[0]!.version).toBe(1);
      const administrative = (await service.create(manager, {
        ...fields,
        employeeId,
        cycleId: administrativeCycle,
        kind: "PERFORMANCE",
      })) as { purpose: string };
      expect(administrative.purpose).toBe("ADMINISTRATIVE");
      const selfCopy = (await new PrivacyService(db).exportMine(employee)) as {
        profile: Record<string, unknown>;
        goals: { id: string }[];
        goalRevisions: { goal_id: string }[];
        goalCheckins: { goal_id: string }[];
        developmentActions: { id: string }[];
        developmentEvents: { action_id: string }[];
      };
      expect(selfCopy.profile.id).toBe(employeeId);
      expect(selfCopy.profile).not.toHaveProperty("password_hash");
      expect(selfCopy.goals).toHaveLength(2);
      expect(selfCopy.goalRevisions).toHaveLength(3);
      expect(selfCopy.goalCheckins).toHaveLength(1);
      expect(selfCopy.developmentActions.map((row) => row.id)).toEqual([
        action.id,
      ]);
      expect(selfCopy.developmentEvents).toHaveLength(3);
      expect(
        selfCopy.goalRevisions.every(
          (row) =>
            row.goal_id === created.id ||
            selfCopy.goals.some((goal) => goal.id === row.goal_id),
        ),
      ).toBe(true);
      const otherCopy = (await new PrivacyService(db).exportMine(
        principal(otherTenantId, "TENANT_ADMIN", otherTenant),
      )) as { goals: unknown[] };
      expect(otherCopy.goals).toHaveLength(0);
      await expect(
        service.checkin(outsider, created.id, {
          progress: "Unauthorized manager tried to record progress",
          nextAction: "No authorized next action",
        }),
      ).rejects.toThrow("outside access scope");
      await expect(
        pg.query(
          "UPDATE goal_revisions SET reason='tampered' WHERE goal_id=$1",
          [created.id],
        ),
      ).rejects.toThrow("append-only");
      await expect(
        pg.query(
          "UPDATE development_action_events SET note='tampered' WHERE action_id=$1",
          [action.id],
        ),
      ).rejects.toThrow("append-only");
      await expect(
        pg.query(
          "UPDATE audit_events SET action='Tampered' WHERE tenant_id=$1",
          [tenantId],
        ),
      ).rejects.toThrow("append-only");
    } finally {
      await pg.close();
    }
  }, 60000);
});
