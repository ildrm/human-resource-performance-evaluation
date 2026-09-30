import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Database, SqlClient } from "./db.js";
import { FeedbackService } from "./feedback.service.js";
import type { Principal } from "./security.js";

describe("behavior scales and anonymous feedback", () => {
  it("separates scale approval and suppresses small anonymous groups", async () => {
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
      const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const reviewerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const peerIds = [
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ];
      const outsiderId = "99999999-9999-4999-8999-999999999999";
      const jobId = "11111111-2222-4333-8444-555555555555";
      const cycleId = "22222222-3333-4444-8555-666666666666";
      await pg.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A')", [
        tenantId,
      ]);
      await pg.query(
        "INSERT INTO jobs(tenant_id,id,name,family,purpose,version,approved) VALUES ($1,$2,'Nurse','Care','Provide care',1,true)",
        [tenantId, jobId],
      );
      const people = [adminId, reviewerId, subjectId, ...peerIds, outsiderId];
      for (const [index, id] of people.entries()) {
        await pg.query(
          "INSERT INTO users(tenant_id,id,email,name,password_hash,role,job_id) VALUES ($1,$2,$3,$4,'test',$5,$6)",
          [
            tenantId,
            id,
            `person-${index}@example.test`,
            `Person ${index}`,
            index < 2 ? "HR_ADMIN" : "EMPLOYEE",
            index === 2 ? jobId : null,
          ],
        );
      }
      await pg.query(
        "INSERT INTO cycles(tenant_id,id,name,starts_on,ends_on,purpose) VALUES ($1,$2,'Review','2026-01-01','2026-01-31','DEVELOPMENT')",
        [tenantId, cycleId],
      );
      const db = {
        tenant<T>(
          tenant: string,
          fn: (client: SqlClient) => Promise<T>,
        ): Promise<T> {
          return pg.transaction(async (tx) => {
            await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
              tenant,
            ]);
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
      const service = new FeedbackService(db);
      const principal = (
        userId: string,
        role: Principal["role"],
      ): Principal => ({
        tenantId,
        userId,
        employeeId: userId,
        role,
        exp: Date.now() + 10000,
      });
      const admin = principal(adminId, "HR_ADMIN");
      const reviewer = principal(reviewerId, "HR_ADMIN");
      const subject = principal(subjectId, "EMPLOYEE");
      const scale = (await service.createScale(admin, {
        jobId,
        name: "Observable collaboration",
        version: 1,
        jobAnalysisReference: "Interviewed care team members",
        developmentMethod: "Behavioral examples from job analysis",
        limitations:
          "Illustrative local policy, not yet psychometrically validated",
        anchors: [1, 2, 3, 4, 5].map((level) => ({
          level,
          behavior: `Observable coordination behavior at anchored level ${level}`,
        })),
      })) as { id: string };
      await expect(
        service.activateScale(admin, scale.id, {
          approvalReference: "Independent content review case 1",
        }),
      ).rejects.toThrow("another reviewer");
      await service.activateScale(reviewer, scale.id, {
        approvalReference: "Independent content review case 1",
      });
      const input = {
        employeeId: subjectId,
        cycleId,
        scaleId: scale.id,
        minimumRespondents: 3,
        weights: [{ relationship: "PEER", weight: "1" }],
        invitations: [
          ...peerIds.map((respondentId) => ({
            respondentId,
            relationship: "PEER",
          })),
          { respondentId: subjectId, relationship: "SELF" },
        ],
      };
      const campaign = (await service.createCampaign(admin, input)) as {
        id: string;
      };
      expect(
        (await service.assignments(principal(peerIds[0]!, "EMPLOYEE"))) as {
          assignments: unknown[];
        },
      ).toMatchObject({ assignments: [{ campaign_id: campaign.id }] });
      expect(await service.summary(subject, campaign.id)).toMatchObject({
        status: "NOT_RELEASED",
      });
      await expect(
        service.rate(principal(outsiderId, "EMPLOYEE"), campaign.id, {
          level: 5,
          observedExample: "Uninvited observation",
        }),
      ).rejects.toThrow("Assignment not found");
      for (const [index, peerId] of peerIds.entries()) {
        await service.rate(principal(peerId, "EMPLOYEE"), campaign.id, {
          level: index + 3,
          observedExample: `Observed coordinated handoff number ${index + 1}`,
        });
      }
      await service.rate(subject, campaign.id, {
        level: 1,
        observedExample: "Self reflection on the care handoff",
      });
      await expect(service.closeCampaign(admin, campaign.id)).rejects.toThrow(
        "another reviewer",
      );
      await service.closeCampaign(reviewer, campaign.id);
      const summary = (await service.summary(subject, campaign.id)) as {
        status: string;
        weightedScore: string;
        selfScore: string;
      };
      expect(summary).toMatchObject({
        status: "RELEASED",
        weightedScore: "4.00",
        selfScore: "1.00",
      });
      for (const peerId of peerIds)
        expect(JSON.stringify(summary)).not.toContain(peerId);
      await expect(
        service.summary(principal(outsiderId, "EMPLOYEE"), campaign.id),
      ).rejects.toThrow();

      const nextCycleId = "33333333-4444-4555-8666-777777777777";
      await pg.query(
        "INSERT INTO cycles(tenant_id,id,name,starts_on,ends_on,purpose) VALUES ($1,$2,'Second review','2026-02-01','2026-02-28','DEVELOPMENT')",
        [tenantId, nextCycleId],
      );
      const small = (await service.createCampaign(admin, {
        ...input,
        cycleId: nextCycleId,
      })) as { id: string };
      for (const peerId of peerIds.slice(0, 2))
        await service.rate(principal(peerId, "EMPLOYEE"), small.id, {
          level: 4,
          observedExample: "Observed a shared team handoff",
        });
      await service.closeCampaign(reviewer, small.id);
      expect(await service.summary(subject, small.id)).toMatchObject({
        status: "SUPPRESSED",
      });
    } finally {
      await pg.close();
    }
  }, 60000);
});
