import { randomUUID } from "node:crypto";
import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { audit } from "./audit.js";
import { Database } from "./db.js";
import type { Principal } from "./security.js";

@Injectable()
export class PrivacyService {
  constructor(private readonly db: Database) {}

  async exportMine(p: Principal): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const profile = await client.query(
        "SELECT id,email,name,role,manager_id,job_id,created_at FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, p.userId],
      );
      if (!profile.rows[0])
        throw new NotFoundException("Active user not found");
      const [
        evidence,
        evaluations,
        goals,
        goalRevisions,
        goalCheckins,
        developmentActions,
        developmentEvents,
        improvementPlans,
        improvementEvents,
        governanceCases,
        governanceEvents,
        contextRecords,
        contextReviews,
        organizationAssignments,
        organizationEvents,
      ] = await Promise.all([
        client.query(
          "SELECT id,metric_id,observed_at,value::text,data_state,source,external_ref,note,numerator::text,denominator::text,verification_state,verified_at,imported_at FROM evidence WHERE tenant_id=$1 AND employee_id=$2 ORDER BY observed_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT e.id,e.cycle_id,c.name AS cycle_name,c.purpose,e.template_id,e.validation_dossier_id,e.status,e.score::text,e.final_score::text,e.input_snapshot,e.result_snapshot,e.quality_input_snapshot,e.quality_result_snapshot,e.org_snapshot,e.manager_note,e.published_at,e.created_at FROM evaluations e JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id WHERE e.tenant_id=$1 AND e.employee_id=$2 AND e.status IN ('PUBLISHED','ACKNOWLEDGED','APPEALED') ORDER BY e.created_at,e.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT id,cycle_id,purpose,kind,created_at FROM goals WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT r.goal_id,r.version,r.effective_at,r.description,r.baseline,r.threshold,r.target,r.stretch,r.due_date,r.priority,r.weight::text,r.review_cadence,r.dependencies,r.status,r.reason,r.created_at FROM goal_revisions r JOIN goals g ON g.tenant_id=r.tenant_id AND g.id=r.goal_id WHERE r.tenant_id=$1 AND g.employee_id=$2 ORDER BY r.goal_id,r.version LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT ci.id,ci.goal_id,ci.progress,ci.obstacle,ci.support_needed,ci.evidence_reference,ci.next_action,ci.created_at FROM goal_checkins ci JOIN goals g ON g.tenant_id=ci.tenant_id AND g.id=ci.goal_id WHERE ci.tenant_id=$1 AND g.employee_id=$2 ORDER BY ci.created_at,ci.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT id,cycle_id,goal_id,competency_gap,current_level,target_level,activity,training,mentor_id,stretch_assignment,due_date,status,created_at,completed_at FROM development_actions WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT e.id,e.action_id,e.kind,e.note,e.evidence_reference,e.actor_id,e.created_at FROM development_action_events e JOIN development_actions a ON a.tenant_id=e.tenant_id AND a.id=e.action_id WHERE e.tenant_id=$1 AND a.employee_id=$2 ORDER BY e.created_at,e.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT id,source_evaluation_id,gap,expected_standard,supporting_evidence,required_improvement,support_provided,measurement_criteria,starts_on,ends_on,status,decision,final_decision,activated_at,decided_at,closed_at FROM improvement_plans WHERE tenant_id=$1 AND employee_id=$2 AND status<>'DRAFT' ORDER BY created_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT e.id,e.plan_id,e.kind,e.note,e.occurred_on,e.outcome,e.evidence_reference,e.policy_reference,e.actor_id,e.created_at FROM improvement_plan_events e JOIN improvement_plans i ON i.tenant_id=e.tenant_id AND i.id=e.plan_id WHERE e.tenant_id=$1 AND i.employee_id=$2 AND i.status<>'DRAFT' ORDER BY e.created_at,e.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT id,event_type,occurred_on,description,initial_evidence_reference,status,reported_by,triaged_by,decided_by,resolved_by,created_at,triaged_at,decided_at,resolved_at FROM governance_cases WHERE tenant_id=$1 AND employee_id=$2 AND status<>'REPORTED' ORDER BY created_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT e.id,e.case_id,e.kind,e.note,e.evidence_reference,e.policy_basis,e.actor_id,e.created_at FROM governance_case_events e JOIN governance_cases g ON g.tenant_id=e.tenant_id AND g.id=e.case_id WHERE e.tenant_id=$1 AND g.employee_id=$2 AND g.status<>'REPORTED' ORDER BY e.created_at,e.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT id,cycle_id,kind,description,impact,evidence_reference,expected_exposure::text,actual_exposure::text,exposure_unit,status,created_by,reviewed_by,created_at,reviewed_at FROM context_records WHERE tenant_id=$1 AND employee_id=$2 ORDER BY created_at,id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT v.id,v.context_id,v.decision,v.note,v.evidence_reference,v.reviewer_id,v.created_at FROM context_reviews v JOIN context_records r ON r.tenant_id=v.tenant_id AND r.id=v.context_id WHERE v.tenant_id=$1 AND r.employee_id=$2 ORDER BY v.created_at,v.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT a.id,a.unit_id,u.code,u.name AS unit_name,u.kind,a.assignment_role,a.effective_from,a.effective_to,a.reason,a.created_at FROM employee_org_assignments a JOIN organization_units u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id WHERE a.tenant_id=$1 AND a.employee_id=$2 ORDER BY a.created_at,a.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
        client.query(
          "SELECT e.id,e.assignment_id,e.kind,e.effective_to,e.reason,e.actor_id,e.created_at FROM employee_org_assignment_events e JOIN employee_org_assignments a ON a.tenant_id=e.tenant_id AND a.id=e.assignment_id WHERE e.tenant_id=$1 AND a.employee_id=$2 ORDER BY e.created_at,e.id LIMIT 10001",
          [p.tenantId, p.userId],
        ),
      ]);
      if (
        [
          evidence,
          evaluations,
          goals,
          goalRevisions,
          goalCheckins,
          developmentActions,
          developmentEvents,
          improvementPlans,
          improvementEvents,
          governanceCases,
          governanceEvents,
          contextRecords,
          contextReviews,
          organizationAssignments,
          organizationEvents,
        ].some((result) => result.rows.length > 10000)
      )
        throw new PayloadTooLargeException(
          "Self-service copy exceeds 10,000 rows in one category; request an assisted export",
        );
      const evaluationIds = evaluations.rows.map(
        (row) => (row as { id: string }).id,
      );
      const [calibration, appeals, amendments, reviewMessages] =
        evaluationIds.length
          ? await Promise.all([
              client.query(
                "SELECT evaluation_id,previous_score::text,proposed_score::text,reason,evidence_reference,policy_basis,created_at FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 10001",
                [p.tenantId, evaluationIds],
              ),
              client.query(
                "SELECT id,evaluation_id,reason,statement,state,outcome,resolution,remedy,notice_status,created_at,resolved_at FROM appeals WHERE tenant_id=$1 AND employee_id=$2 AND evaluation_id=ANY($3::uuid[]) ORDER BY created_at,id LIMIT 10001",
                [p.tenantId, p.userId, evaluationIds],
              ),
              client.query(
                "SELECT id,evaluation_id,appeal_id,previous_effective_score::text,amended_score::text,reason,created_at FROM evaluation_amendments WHERE tenant_id=$1 AND evaluation_id=ANY($2::uuid[]) ORDER BY created_at,id LIMIT 10001",
                [p.tenantId, evaluationIds],
              ),
              client.query(
                "SELECT id,evaluation_id,author_id,topic,body,created_at FROM review_messages WHERE tenant_id=$1 AND evaluation_id=ANY($2::uuid[]) AND channel='SHARED' ORDER BY created_at,id LIMIT 10001",
                [p.tenantId, evaluationIds],
              ),
            ])
          : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
      if (
        calibration.rows.length > 10000 ||
        appeals.rows.length > 10000 ||
        amendments.rows.length > 10000 ||
        reviewMessages.rows.length > 10000
      )
        throw new PayloadTooLargeException(
          "Self-service copy exceeds 10,000 decision rows; request an assisted export",
        );
      const copy = {
        generatedAt: new Date().toISOString(),
        scope:
          "Self-service copy of profile, evidence, published evaluations and their decisions and shared review messages, goals and check-ins, development actions, activated improvement plans, triaged governance cases, submitted context records, and organization assignments. It excludes unpublished reviews, internal review messages, draft improvement plans, untriaged case reports, other people's data, and individual anonymous feedback responses. A formal privacy request may have a different scope under local policy.",
        profile: profile.rows[0],
        evidence: evidence.rows,
        evaluations: evaluations.rows,
        calibration: calibration.rows,
        appeals: appeals.rows,
        amendments: amendments.rows,
        reviewMessages: reviewMessages.rows,
        goals: goals.rows,
        goalRevisions: goalRevisions.rows,
        goalCheckins: goalCheckins.rows,
        developmentActions: developmentActions.rows,
        developmentEvents: developmentEvents.rows,
        improvementPlans: improvementPlans.rows,
        improvementEvents: improvementEvents.rows,
        governanceCases: governanceCases.rows,
        governanceEvents: governanceEvents.rows,
        contextRecords: contextRecords.rows,
        contextReviews: contextReviews.rows,
        organizationAssignments: organizationAssignments.rows,
        organizationEvents: organizationEvents.rows,
      };
      await audit(
        client,
        p.tenantId,
        p.userId,
        "SelfDataExported",
        "export",
        randomUUID(),
        {
          evidenceCount: evidence.rows.length,
          evaluationCount: evaluations.rows.length,
          reviewMessageCount: reviewMessages.rows.length,
          goalCount: goals.rows.length,
          developmentActionCount: developmentActions.rows.length,
          improvementPlanCount: improvementPlans.rows.length,
          governanceCaseCount: governanceCases.rows.length,
          contextRecordCount: contextRecords.rows.length,
          format: "JSON",
        },
      );
      return copy;
    });
  }
}
