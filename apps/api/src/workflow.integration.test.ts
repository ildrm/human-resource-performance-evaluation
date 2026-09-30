import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { SqlClient, Database } from "./db.js";
import type { Principal } from "./security.js";
import { GovernanceService } from "./governance.service.js";
import { ContextService } from "./context.service.js";
import { ConflictsService } from "./conflicts.service.js";
import { DiscussionService } from "./discussion.service.js";
import { TrendService } from "./trend.service.js";
import { OrganizationService } from "./organization.service.js";
import { PrivacyService } from "./privacy.service.js";
import { QualityService } from "./quality.service.js";
import { ValidationService } from "./validation.service.js";
import { WorkspaceService } from "./workspace.service.js";

describe("authoritative review workflow in embedded PostgreSQL", () => {
  it("keeps a published score reproducible and rejects another tenant", async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(await readFile(resolve("migrations/001_core.sql"), "utf8"));
      await pg.exec(
        await readFile(resolve("migrations/002_review_actors.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/003_audit_payload.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/004_behavior_feedback.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/005_sessions.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/006_evidence_quality.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/007_goals.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/008_validation_dossiers.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(resolve("migrations/009_auth_throttle.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/010_development_actions.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(resolve("migrations/011_improvement_plans.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/012_governance_cases.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/013_append_only_records.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(resolve("migrations/014_context_records.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/015_proportion_measurement.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/016_organization_history.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(resolve("migrations/017_review_conflicts.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/018_review_discussion.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/019_result_provenance.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/020_appeal_amendments.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(resolve("migrations/021_person_snapshot.sql"), "utf8"),
      );
      await pg.exec(
        await readFile(
          resolve("migrations/022_template_governance.sql"),
          "utf8",
        ),
      );
      await pg.exec(
        await readFile(resolve("migrations/023_outbox_worker.sql"), "utf8"),
      );
      const tenantA = "11111111-1111-4111-8111-111111111111";
      const tenantB = "22222222-2222-4222-8222-222222222222";
      const adminA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const adminB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await pg.query(
        "INSERT INTO tenants(id,slug,name) VALUES ($1,$2,$3),($4,$5,$6)",
        [tenantA, "a", "A", tenantB, "b", "B"],
      );
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'admin-a@example.test','Admin A','test','TENANT_ADMIN'),($3,$4,'admin-b@example.test','Admin B','test','TENANT_ADMIN')",
        [tenantA, adminA, tenantB, adminB],
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
      const service = new WorkspaceService(database);
      const admin: Principal = {
        tenantId: tenantA,
        userId: adminA,
        employeeId: adminA,
        role: "TENANT_ADMIN",
        exp: Date.now() + 10000,
      };
      const other: Principal = {
        tenantId: tenantB,
        userId: adminB,
        employeeId: adminB,
        role: "TENANT_ADMIN",
        exp: Date.now() + 10000,
      };
      const job = (await service.createJob(admin, {
        name: "Quality technician",
        family: "Manufacturing",
        purpose: "Produce conforming parts",
        approved: true,
      })) as { id: string };
      const metric = (await service.createMetric(admin, {
        code: "quality",
        name: "Accepted batches",
        construct: "Output quality",
        unit: "batches",
        direction: "HIGHER",
        rationale: "Job-relevant verified output",
        limitations: "Does not capture all work",
        controllability: "PARTIAL",
      })) as { id: string };
      const employee = (await service.createPerson(admin, {
        name: "Employee One",
        email: "employee@example.test",
        password: "long-unique-password",
        role: "EMPLOYEE",
        jobId: job.id,
      })) as { id: string };
      const organization = new OrganizationService(database);
      const topUnit = (await organization.createUnit(admin, {
        code: "SYNTHETIC-ORG",
        name: "Synthetic organization",
        kind: "ORGANIZATION",
        effectiveFrom: "2026-01-01",
      })) as { id: string };
      const teamUnit = (await organization.createUnit(admin, {
        code: "SYNTHETIC-TEAM",
        name: "Inspection team",
        kind: "TEAM",
        parentId: topUnit.id,
        effectiveFrom: "2026-01-01",
      })) as { id: string };
      await expect(
        organization.createUnit(admin, {
          code: "SYNTHETIC-TEAM",
          name: "Overlapping team version",
          kind: "TEAM",
          effectiveFrom: "2026-01-15",
        }),
      ).rejects.toThrow("overlapping version");
      const primaryAssignment = (await organization.assign(admin, {
        employeeId: employee.id,
        unitId: teamUnit.id,
        assignmentRole: "PRIMARY",
        effectiveFrom: "2026-01-01",
        reason: "Synthetic primary organization assignment",
      })) as { id: string };
      await organization.assign(admin, {
        employeeId: employee.id,
        unitId: topUnit.id,
        assignmentRole: "MATRIX",
        effectiveFrom: "2026-01-01",
        reason: "Synthetic matrix project assignment",
      });
      await expect(
        organization.assign(admin, {
          employeeId: employee.id,
          unitId: topUnit.id,
          assignmentRole: "PRIMARY",
          effectiveFrom: "2026-01-15",
          reason: "Attempted overlapping primary assignment",
        }),
      ).rejects.toThrow("overlaps");
      await expect(organization.history(other, employee.id)).rejects.toThrow(
        "not found",
      );
      const calibrator = (await service.createPerson(admin, {
        name: "Independent Calibrator",
        email: "calibrator@example.test",
        password: "long-unique-password",
        role: "CALIBRATOR",
      })) as { id: string };
      const replacementCalibrator = (await service.createPerson(admin, {
        name: "Replacement Calibrator",
        email: "replacement-calibrator@example.test",
        password: "long-unique-password",
        role: "CALIBRATOR",
      })) as { id: string };
      const publisher = (await service.createPerson(admin, {
        name: "HR Publisher",
        email: "publisher@example.test",
        password: "long-unique-password",
        role: "HR_ADMIN",
      })) as { id: string };
      const investigator = (await service.createPerson(admin, {
        name: "Independent Investigator",
        email: "investigator@example.test",
        password: "long-unique-password",
        role: "HR_ADMIN",
      })) as { id: string };
      const conflictResolver = (await service.createPerson(admin, {
        name: "Independent Conflict Resolver",
        email: "conflict-resolver@example.test",
        password: "long-unique-password",
        role: "HR_ADMIN",
      })) as { id: string };
      const calibratorPrincipal: Principal = {
        ...admin,
        userId: calibrator.id,
        employeeId: calibrator.id,
        role: "CALIBRATOR",
      };
      const replacementCalibratorPrincipal: Principal = {
        ...admin,
        userId: replacementCalibrator.id,
        employeeId: replacementCalibrator.id,
        role: "CALIBRATOR",
      };
      const publisherPrincipal: Principal = {
        ...admin,
        userId: publisher.id,
        employeeId: publisher.id,
        role: "HR_ADMIN",
      };
      const investigatorPrincipal: Principal = {
        ...admin,
        userId: investigator.id,
        employeeId: investigator.id,
        role: "HR_ADMIN",
      };
      const conflictResolverPrincipal: Principal = {
        ...admin,
        userId: conflictResolver.id,
        employeeId: conflictResolver.id,
        role: "HR_ADMIN",
      };
      const quality = new QualityService(database);
      const policy = (await quality.createPolicy(admin, {
        version: 1,
        freshnessDays: 60,
        unreferencedEvidenceFactor: "0.5",
        weights: {
          completeness: "0.25",
          freshness: "0.25",
          sampleAdequacy: "0.25",
          traceability: "0.25",
        },
        rationale: "Local disclosed policy for synthetic evidence review",
      })) as { id: string };
      await expect(
        quality.activatePolicy(admin, policy.id, {
          reviewReference: "Independent EQI policy review",
        }),
      ).rejects.toThrow("another reviewer");
      await quality.activatePolicy(publisherPrincipal, policy.id, {
        reviewReference: "Independent EQI policy review",
      });
      const template = (await service.createTemplate(admin, {
        jobId: job.id,
        name: "Technician 2026",
        version: 1,
        effectiveFrom: "2026-01-01",
        scientificRationale:
          "Verified accepted batches reflect the analyzed technician output task.",
        limitations:
          "Synthetic demonstration data cannot establish predictive validity.",
        dimensions: [
          {
            name: "Quality",
            weight: "1",
            metrics: [{ metricId: metric.id, weight: "1", required: true }],
          },
        ],
      })) as { id: string };
      await expect(
        service.activateTemplate(admin, template.id),
      ).rejects.toThrow("not found");
      await service.reviewTemplate(admin, template.id);
      const templateValidation = {
        validationNote:
          "Independent review of role alignment and expected arithmetic.",
        fixtureEvidenceReference:
          "Synthetic golden fixture quality-technician-v1",
      };
      await expect(
        service.validateTemplate(admin, template.id, templateValidation),
      ).rejects.toThrow("independent reviewer");
      await service.validateTemplate(
        calibratorPrincipal,
        template.id,
        templateValidation,
      );
      await expect(service.approveTemplate(admin, template.id)).rejects.toThrow(
        "independent of author",
      );
      await service.approveTemplate(publisherPrincipal, template.id);
      await service.activateTemplate(admin, template.id);
      await service.createTarget(admin, {
        metricId: metric.id,
        effectiveFrom: "2026-01-01",
        critical: "0",
        threshold: "2",
        target: "10",
        stretch: "20",
        anchors: [
          { actual: "0", score: "0" },
          { actual: "10", score: "100" },
          { actual: "20", score: "120" },
        ],
        reason: "Approved role standard",
      });
      const cycle = (await service.createCycle(admin, {
        name: "January 2026",
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        purpose: "DEVELOPMENT",
      })) as { id: string };
      await expect(
        service.addEvidence(admin, {
          employeeId: employee.id,
          metricId: metric.id,
          observedAt: "2026-01-12T11:00:00.000Z",
          value: "1",
          dataState: "ZERO",
          source: "Invalid zero test",
        }),
      ).rejects.toThrow();
      const item = (await service.addEvidence(admin, {
        employeeId: employee.id,
        metricId: metric.id,
        observedAt: "2026-01-12T12:00:00.000Z",
        value: "8",
        dataState: "OBSERVED",
        source: "Verified batch register",
      })) as { id: string };
      await service.verifyEvidence(admin, item.id, true);
      const calculated = (await service.calculateEvaluation(
        admin,
        employee.id,
        cycle.id,
      )) as {
        id: string;
        score: string;
        status: string;
        quality_result_snapshot: { index: string; policyVersion: number };
        org_snapshot: { assignment_role: string; name: string }[];
      };
      expect(calculated.status).toBe("CALCULATED");
      expect(calculated.score).toBe("80.0000");
      expect(calculated.org_snapshot).toHaveLength(2);
      expect(
        calculated.org_snapshot.some(
          (item) =>
            item.name === "Inspection team" &&
            item.assignment_role === "PRIMARY",
        ),
      ).toBe(true);
      await organization.endAssignment(admin, primaryAssignment.id, {
        effectiveTo: "2026-01-15",
        reason: "Synthetic transfer after recorded review",
      });
      const retained = (await service.evaluation(admin, calculated.id)) as {
        org_snapshot: unknown[];
      };
      expect(retained.org_snapshot).toHaveLength(2);
      await organization.assign(admin, {
        employeeId: employee.id,
        unitId: topUnit.id,
        assignmentRole: "PRIMARY",
        effectiveFrom: "2026-01-16",
        reason: "Synthetic next primary assignment",
      });
      const employeeCopy = (await new PrivacyService(database).exportMine({
        ...admin,
        userId: employee.id,
        employeeId: employee.id,
        role: "EMPLOYEE",
      })) as {
        organizationAssignments: unknown[];
        organizationEvents: unknown[];
      };
      expect(employeeCopy.organizationAssignments).toHaveLength(3);
      expect(employeeCopy.organizationEvents).toHaveLength(4);
      expect(calculated.quality_result_snapshot.policyVersion).toBe(1);
      expect(Number(calculated.quality_result_snapshot.index)).toBeGreaterThan(
        0,
      );
      await service.submit(admin, calculated.id, {
        managerNote: "Consistent, verified quality work.",
      });
      const decision = {
        proposedScore: "82",
        reason: "Documented additional role contribution",
        evidenceReference: "case-123",
        policyBasis: "approved calibration policy",
      };
      await expect(
        service.calibrate(admin, calculated.id, decision),
      ).rejects.toThrow("independent reviewer");
      await expect(
        service.publish(publisherPrincipal, calculated.id),
      ).rejects.toThrow("Independent calibration");
      await service.calibrate(calibratorPrincipal, calculated.id, decision);
      await expect(service.publish(admin, calculated.id)).rejects.toThrow(
        "separate approver",
      );
      const conflicts = new ConflictsService(database);
      const declaredConflict = (await conflicts.declare(
        investigatorPrincipal,
        calculated.id,
        {
          stage: "PUBLICATION",
          category: "PRIOR_INVOLVEMENT",
          reason:
            "I was previously involved in this synthetic review decision.",
        },
      )) as { id: string };
      await expect(
        service.publish(publisherPrincipal, calculated.id),
      ).rejects.toThrow("unresolved review conflict");
      await expect(
        conflicts.resolve(investigatorPrincipal, declaredConflict.id, {
          replacementActorId: publisher.id,
          resolutionNote:
            "Independent reassignment after declared involvement.",
        }),
      ).rejects.toThrow("independent resolver");
      await conflicts.resolve(conflictResolverPrincipal, declaredConflict.id, {
        replacementActorId: publisher.id,
        resolutionNote: "Independent reassignment after declared involvement.",
      });
      await expect(
        service.publish(investigatorPrincipal, calculated.id),
      ).rejects.toThrow("conflicted actor");
      await service.publish(publisherPrincipal, calculated.id);
      const employeePrincipal: Principal = {
        ...admin,
        userId: employee.id,
        employeeId: employee.id,
        role: "EMPLOYEE",
      };
      const discussion = new DiscussionService(database);
      const internalMessage = (await discussion.post(
        calibratorPrincipal,
        calculated.id,
        {
          channel: "INTERNAL",
          topic: "CALIBRATION",
          body: "Calibration rationale is for authorized review staff only.",
        },
      )) as { id: string };
      const sharedMessage = (await discussion.post(admin, calculated.id, {
        channel: "SHARED",
        topic: "REVIEW",
        body: "Please review the published evaluation and add any comments.",
      })) as { id: string };
      const employeeMessages = (await discussion.list(
        employeePrincipal,
        calculated.id,
      )) as { messages: { id: string }[] };
      expect(employeeMessages.messages.map((item) => item.id)).toEqual([
        sharedMessage.id,
      ]);
      await expect(
        discussion.post(employeePrincipal, calculated.id, {
          channel: "INTERNAL",
          topic: "REVIEW",
          body: "Attempt to enter internal discussion.",
        }),
      ).rejects.toThrow("internal discussion");
      await expect(discussion.list(other, calculated.id)).rejects.toThrow(
        "not found",
      );
      await expect(
        pg.query(
          "UPDATE review_messages SET body='changed' WHERE tenant_id=$1 AND id=$2",
          [tenantA, internalMessage.id],
        ),
      ).rejects.toThrow("append-only");
      const discussionCopy = (await new PrivacyService(database).exportMine(
        employeePrincipal,
      )) as { reviewMessages: { id: string }[] };
      expect(discussionCopy.reviewMessages.map((item) => item.id)).toEqual([
        sharedMessage.id,
      ]);
      const viewed = (await service.evaluation(
        employeePrincipal,
        calculated.id,
      )) as { score: string; final_score: string };
      expect(viewed.score).toBe("80.0000");
      expect(viewed.final_score).toBe("82.0000");
      await service.acknowledge(employeePrincipal, calculated.id);
      const appeal = (await service.appeal(employeePrincipal, calculated.id, {
        reason: "CONTEXT",
        statement: "Please review the documented disruption.",
      })) as { id: string };
      const appealDecision = {
        outcome: "PARTIALLY_UPHELD",
        resolution: "The submitted context changes the documented decision.",
        remedy:
          "Publish an amended effective score and preserve the prior result.",
        correctedScore: "83.5",
      };
      await expect(
        service.resolveAppeal(admin, appeal.id, appealDecision),
      ).rejects.toThrow("independent reviewer");
      await expect(
        service.resolveAppeal(publisherPrincipal, appeal.id, appealDecision),
      ).rejects.toThrow("independent reviewer");
      const resolvedAppeal = (await service.resolveAppeal(
        investigatorPrincipal,
        appeal.id,
        appealDecision,
      )) as {
        outcome: string;
        notice_status: string;
      };
      expect(resolvedAppeal.outcome).toBe("PARTIALLY_UPHELD");
      expect(resolvedAppeal.notice_status).toBe("PENDING");
      const amendedView = (await service.evaluation(
        employeePrincipal,
        calculated.id,
      )) as {
        final_score: string;
        effective_score: string;
        amendments: {
          previous_effective_score: string;
          amended_score: string;
        }[];
      };
      expect(amendedView.final_score).toBe("82.0000");
      expect(amendedView.effective_score).toBe("83.5000");
      expect(amendedView.amendments[0]?.previous_effective_score).toBe(
        "82.0000",
      );
      const replay = (await service.replay(
        employeePrincipal,
        calculated.id,
      )) as { matches: boolean; qualityMatches: boolean };
      expect(replay.matches).toBe(true);
      expect(replay.qualityMatches).toBe(true);
      const report = (await service.report(admin)) as {
        rows: { score: string; final_score: string }[];
      };
      const csv = await service.exportReport(admin);
      expect(csv).toContain(
        `"${report.rows[0]!.score}","${report.rows[0]!.final_score}"`,
      );
      await service.createTarget(admin, {
        metricId: metric.id,
        effectiveFrom: "2026-02-01",
        critical: "0",
        threshold: "5",
        target: "20",
        stretch: "30",
        anchors: [
          { actual: "0", score: "0" },
          { actual: "20", score: "100" },
          { actual: "30", score: "120" },
        ],
        reason: "Prospective February standard",
      });
      const nextPolicy = (await quality.createPolicy(admin, {
        version: 2,
        freshnessDays: 30,
        unreferencedEvidenceFactor: "0.25",
        weights: {
          completeness: "0.4",
          freshness: "0.2",
          sampleAdequacy: "0.2",
          traceability: "0.2",
        },
        rationale: "Prospective revised local evidence quality policy",
      })) as { id: string };
      await quality.activatePolicy(publisherPrincipal, nextPolicy.id, {
        reviewReference: "Independent prospective policy review",
      });
      const preserved = (await service.replay(
        employeePrincipal,
        calculated.id,
      )) as {
        matches: boolean;
        qualityMatches: boolean;
        qualityStored: { policyVersion: number };
      };
      expect(preserved.matches).toBe(true);
      expect(preserved.qualityMatches).toBe(true);
      expect(preserved.qualityStored.policyVersion).toBe(1);
      const adminCycle = (await service.createCycle(admin, {
        name: "Administrative January 2026",
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        purpose: "ADMINISTRATIVE",
      })) as { id: string };
      const administrative = (await service.calculateEvaluation(
        admin,
        employee.id,
        adminCycle.id,
      )) as { id: string };
      await expect(
        discussion.list(employeePrincipal, administrative.id),
      ).rejects.toThrow("not yet published");
      await expect(
        discussion.post(admin, administrative.id, {
          channel: "SHARED",
          topic: "REVIEW",
          body: "Premature shared discussion must be rejected.",
        }),
      ).rejects.toThrow("begins after publication");
      await service.submit(admin, administrative.id, {
        managerNote: "Synthetic administrative assessment for governance test",
      });
      const calibrationConflict = (await conflicts.declare(
        calibratorPrincipal,
        administrative.id,
        {
          stage: "CALIBRATION",
          category: "PERSONAL_RELATIONSHIP",
          reason:
            "Synthetic personal relationship requires a different calibrator.",
        },
      )) as { id: string };
      await expect(
        service.calibrate(calibratorPrincipal, administrative.id, decision),
      ).rejects.toThrow("unresolved conflict");
      await conflicts.resolve(investigatorPrincipal, calibrationConflict.id, {
        replacementActorId: replacementCalibrator.id,
        resolutionNote: "Independent reviewer assigned a different calibrator.",
      });
      await expect(
        service.calibrate(calibratorPrincipal, administrative.id, decision),
      ).rejects.toThrow("conflicted actor");
      await service.calibrate(
        replacementCalibratorPrincipal,
        administrative.id,
        decision,
      );
      await expect(
        service.publish(publisherPrincipal, administrative.id),
      ).rejects.toThrow("model evidence dossier");
      const validation = new ValidationService(database);
      const dossier = (await validation.create(admin, {
        templateId: template.id,
        intendedInterpretation:
          "Role-specific evidence summary for a documented administrative review",
        intendedPopulation: "Quality technicians in the synthetic test tenant",
        jobAnalysisReference: "Synthetic technician task analysis record",
        contentEvidenceReference: "Synthetic metric-to-task content mapping",
        reliabilityEvidenceOrRationale:
          "Reliability evidence is not available in this synthetic fixture; a real study is required before use.",
        criterionEvidenceOrRationale:
          "Criterion evidence is not available in this synthetic fixture; a real study is required before use.",
        constructEvidenceOrRationale:
          "Construct evidence is not available in this synthetic fixture; a real study is required before use.",
        fairnessReviewReference:
          "Synthetic fairness review case; no protected data used",
        limitations:
          "Synthetic governance fixture; does not demonstrate scientific validity or legal fitness.",
        revalidateOn: "2027-12-31",
      })) as { id: string };
      await expect(
        validation.review(admin, dossier.id, {
          reviewNote:
            "Independent synthetic content review; no empirical validity claim",
        }),
      ).rejects.toThrow("another actor");
      await validation.review(publisherPrincipal, dossier.id, {
        reviewNote:
          "Independent synthetic content review; no empirical validity claim",
      });
      const governance = new GovernanceService(database);
      const governanceCase = (await governance.create(admin, {
        employeeId: employee.id,
        eventType: "SAFETY",
        occurredOn: new Date().toISOString().slice(0, 10),
        description:
          "Synthetic severe safety event requiring independent review",
        evidenceReference: "Synthetic safety case record 12",
      })) as { id: string };
      await expect(
        governance.detail(employeePrincipal, governanceCase.id),
      ).rejects.toThrow("outside access scope");
      await expect(
        governance.record(admin, governanceCase.id, {
          kind: "TRIAGE",
          note: "Reporter attempted to triage the reported safety case",
        }),
      ).rejects.toThrow("independent HR actor");
      await governance.record(publisherPrincipal, governanceCase.id, {
        kind: "TRIAGE",
        note: "Independent HR reviewer opened the safety investigation",
      });
      await expect(
        service.publish(publisherPrincipal, administrative.id),
      ).rejects.toThrow("held by an open safety or compliance case");
      await expect(
        governance.record(investigatorPrincipal, governanceCase.id, {
          kind: "CONFIRM",
          note: "Tried to confirm before the employee response",
          evidenceReference: "Synthetic safety case record 12",
          policyBasis: "Synthetic local safety policy",
        }),
      ).rejects.toThrow("Employee response is required");
      await governance.record(employeePrincipal, governanceCase.id, {
        kind: "EMPLOYEE_RESPONSE",
        note: "I reviewed the documented case and provided my account",
      });
      await governance.record(investigatorPrincipal, governanceCase.id, {
        kind: "CONFIRM",
        note: "Independent investigator confirmed the event after review",
        evidenceReference: "Synthetic safety case record 12",
        policyBasis: "Synthetic local safety policy",
      });
      await expect(
        service.publish(publisherPrincipal, administrative.id),
      ).rejects.toThrow("held by an open safety or compliance case");
      await expect(
        governance.record(investigatorPrincipal, governanceCase.id, {
          kind: "RESOLVE",
          note: "Finding actor attempted to resolve the same case",
          evidenceReference: "Synthetic remediation record 13",
          policyBasis: "Synthetic local safety policy",
        }),
      ).rejects.toThrow("independent HR actor");
      await governance.record(publisherPrincipal, governanceCase.id, {
        kind: "RESOLVE",
        note: "Independent reviewer confirmed documented remediation",
        evidenceReference: "Synthetic remediation record 13",
        policyBasis: "Synthetic local safety policy",
      });
      const context = new ContextService(database);
      await expect(
        context.create(employeePrincipal, {
          employeeId: employee.id,
          cycleId: adminCycle.id,
          kind: "OPPORTUNITY",
          description:
            "Machine availability reduced the opportunity to complete batches",
          impact: "Fewer eligible production opportunities occurred",
          evidenceReference: "Synthetic machine availability log",
          expectedExposure: "100",
        }),
      ).rejects.toThrow("shared unit");
      const contextRecord = (await context.create(employeePrincipal, {
        employeeId: employee.id,
        cycleId: adminCycle.id,
        kind: "OPPORTUNITY",
        description:
          "Machine availability reduced the opportunity to complete batches",
        impact: "Fewer eligible production opportunities occurred",
        evidenceReference: "Synthetic machine availability log",
        expectedExposure: "100",
        actualExposure: "75",
        exposureUnit: "machine-hours",
      })) as { id: string };
      await expect(
        service.publish(publisherPrincipal, administrative.id),
      ).rejects.toThrow("submitted context is reviewed");
      await expect(
        context.review(employeePrincipal, contextRecord.id, {
          decision: "VERIFIED",
          note: "Employee attempted to verify their own opportunity record",
          evidenceReference: "Synthetic machine availability log",
        }),
      ).rejects.toThrow("Insufficient permission");
      await context.review(publisherPrincipal, contextRecord.id, {
        decision: "VERIFIED",
        note: "Independent reviewer checked the machine availability log",
        evidenceReference: "Synthetic machine availability log",
      });
      const publishedAdministrative = (await service.publish(
        publisherPrincipal,
        administrative.id,
      )) as { validation_dossier_id: string };
      expect(publishedAdministrative.validation_dossier_id).toBe(dossier.id);
      const administrativeView = (await service.evaluation(
        employeePrincipal,
        administrative.id,
      )) as {
        model_dossier: { intended_population: string };
        context: { status: string; actual_exposure: string }[];
      };
      expect(administrativeView.model_dossier.intended_population).toContain(
        "Quality technicians",
      );
      expect(administrativeView.context[0]).toMatchObject({
        status: "VERIFIED",
        actual_exposure: "75.00000000",
      });
      const trend = (await new TrendService(database).forEmployee(
        employeePrincipal,
        employee.id,
      )) as {
        series: { purpose: string; analysis: { status: string } }[];
      };
      expect(trend.series.map((item) => item.purpose).sort()).toEqual([
        "ADMINISTRATIVE",
        "DEVELOPMENT",
      ]);
      expect(
        trend.series.every((item) => item.analysis.status === "INSUFFICIENT"),
      ).toBe(true);
      await expect(
        new TrendService(database).forEmployee(other, employee.id),
      ).rejects.toThrow("Employee not found");
      await validation.retire(publisherPrincipal, dossier.id, {
        reason: "Retired after the synthetic governance test completed",
      });
      const laterAdminCycle = (await service.createCycle(admin, {
        name: "Administrative follow-up January 2026",
        startsOn: "2026-01-01",
        endsOn: "2026-01-31",
        purpose: "ADMINISTRATIVE",
      })) as { id: string };
      const laterAdministrative = (await service.calculateEvaluation(
        admin,
        employee.id,
        laterAdminCycle.id,
      )) as { id: string };
      await service.submit(admin, laterAdministrative.id, {
        managerNote: "Synthetic follow-up assessment after dossier retirement",
      });
      await service.calibrate(
        calibratorPrincipal,
        laterAdministrative.id,
        decision,
      );
      await expect(
        service.publish(publisherPrincipal, laterAdministrative.id),
      ).rejects.toThrow("model evidence dossier");
      await pg.query(
        "UPDATE users SET name='Later personnel name' WHERE tenant_id=$1 AND id=$2",
        [tenantA, employee.id],
      );
      const firstPage = await service.report(admin, { limit: 1 });
      expect(firstPage.rows).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await service.report(admin, {
        limit: 1,
        cursor: firstPage.nextCursor!,
      });
      expect(secondPage.rows[0]?.id).not.toBe(firstPage.rows[0]?.id);
      const frozenRow = (await service.report(admin, { limit: 10 })).rows.find(
        (row) => row.id === calculated.id,
      );
      expect(frozenRow?.employee_name).toBe("Employee One");
      expect(frozenRow?.effective_score).toBe("83.5000");
      await expect(
        service.report(admin, { cursor: "invalid" }),
      ).rejects.toThrow("Invalid report cursor");
      await expect(service.evaluation(other, calculated.id)).rejects.toThrow();
      await expect(service.evidenceFor(other, employee.id)).rejects.toThrow();
    } finally {
      await pg.close();
    }
  }, 60000);
});
