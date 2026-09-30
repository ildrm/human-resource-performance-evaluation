import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { improvementEventInput, improvementPlanInput } from "@hpi/contracts";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database, type SqlClient } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

type PlanAccess = {
  id: string;
  employee_id: string;
  manager_id: string | null;
  status: string;
  created_by: string;
  activated_by: string | null;
  decided_by: string | null;
  decision: string | null;
  starts_on: string | Date;
  ends_on: string | Date;
  decided_at: string | Date | null;
};

@Injectable()
export class ImprovementService {
  constructor(private readonly db: Database) {}

  private async access(
    client: SqlClient,
    p: Principal,
    id: string,
    lock = false,
  ): Promise<PlanAccess> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const result = await client.query<PlanAccess>(
      `SELECT i.id,i.employee_id,u.manager_id,i.status,i.created_by,i.activated_by,i.decided_by,i.decision,i.starts_on,i.ends_on,i.decided_at FROM improvement_plans i JOIN users u ON u.tenant_id=i.tenant_id AND u.id=i.employee_id WHERE i.tenant_id=$1 AND i.id=$2${lock ? " FOR UPDATE OF i" : ""}`,
      [p.tenantId, id],
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException("Improvement plan not found");
    if (
      !canSeeEmployee(p, plan.employee_id, plan.manager_id) ||
      (p.role === "EMPLOYEE" && plan.status === "DRAFT")
    )
      throw new ForbiddenException("Improvement plan outside access scope");
    return plan;
  }

  async list(p: Principal, employeeId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const result = await client.query(
        "SELECT i.id,i.employee_id,i.source_evaluation_id,i.gap,i.expected_standard,i.starts_on,i.ends_on,i.status,i.decision,i.final_decision,i.created_at FROM improvement_plans i WHERE i.tenant_id=$1 AND i.employee_id=$2 AND ($3::text<>'EMPLOYEE' OR i.status<>'DRAFT') ORDER BY i.created_at DESC LIMIT 200",
        [p.tenantId, employeeId, p.role],
      );
      return { plans: result.rows };
    });
  }

  async detail(p: Principal, id: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      await this.access(client, p, id);
      const plan = await client.query(
        "SELECT id,employee_id,source_evaluation_id,gap,expected_standard,supporting_evidence,required_improvement,support_provided,measurement_criteria,starts_on,ends_on,status,created_by,activated_by,decided_by,decision,final_decision,created_at,activated_at,decided_at,closed_at FROM improvement_plans WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, id],
      );
      const events = await client.query(
        "SELECT id,kind,note,occurred_on,outcome,evidence_reference,policy_reference,actor_id,created_at FROM improvement_plan_events WHERE tenant_id=$1 AND plan_id=$2 ORDER BY created_at,id LIMIT 500",
        [p.tenantId, id],
      );
      return { ...plan.rows[0], events: events.rows };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(improvementPlanInput, body);
    if (input.endsOn < input.startsOn)
      throw new BadRequestException("Plan end date must follow its start date");
    if (input.endsOn < new Date().toISOString().slice(0, 10))
      throw new BadRequestException("Cannot create an already-ended plan");
    if (
      (Date.parse(input.endsOn) - Date.parse(input.startsOn)) / 86400000 >
      365
    )
      throw new BadRequestException("Plan duration cannot exceed 365 days");
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, input.employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, input.employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const evaluation = await client.query<{
        status: string;
        purpose: string;
      }>(
        "SELECT e.status,c.purpose FROM evaluations e JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.employee_id=$3",
        [p.tenantId, input.sourceEvaluationId, input.employeeId],
      );
      if (
        !evaluation.rows[0] ||
        evaluation.rows[0].purpose !== "ADMINISTRATIVE" ||
        !["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(
          evaluation.rows[0].status,
        )
      )
        throw new BadRequestException(
          "A published administrative evaluation for this employee is required",
        );
      const existing = await client.query(
        "SELECT 1 FROM improvement_plans WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('DRAFT','ACTIVE','DECIDED','APPEALED') LIMIT 1",
        [p.tenantId, input.employeeId],
      );
      if (existing.rows[0])
        throw new BadRequestException("Employee already has an open plan");
      const result = await client.query<{ id: string; status: string }>(
        "INSERT INTO improvement_plans(tenant_id,employee_id,source_evaluation_id,gap,expected_standard,supporting_evidence,required_improvement,support_provided,measurement_criteria,starts_on,ends_on,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,status",
        [
          p.tenantId,
          input.employeeId,
          input.sourceEvaluationId,
          input.gap,
          input.expectedStandard,
          input.supportingEvidence,
          input.requiredImprovement,
          input.supportProvided,
          input.measurementCriteria,
          input.startsOn,
          input.endsOn,
          p.userId,
        ],
      );
      const plan = result.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ImprovementPlanCreated",
        "improvement_plan",
        plan.id,
        {
          employeeId: input.employeeId,
          sourceEvaluationId: input.sourceEvaluationId,
        },
      );
      return plan;
    });
  }

  async record(p: Principal, id: string, body: unknown): Promise<unknown> {
    const input = parse(improvementEventInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const plan = await this.access(client, p, id, true);
      const state = plan.status;
      const managerAction = () =>
        requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
      const hrAction = () => requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
      const employeeAction = () => {
        requireRole(p, "EMPLOYEE");
        if (p.userId !== plan.employee_id)
          throw new ForbiddenException(
            "Only the employee can respond or appeal",
          );
      };
      const today = new Date().toISOString().slice(0, 10);
      if (input.kind === "ACTIVATED") {
        hrAction();
        if (state !== "DRAFT")
          throw new BadRequestException("Plan is not a draft");
        if (p.userId === plan.created_by)
          throw new ForbiddenException(
            "An independent HR actor must activate the plan",
          );
      } else if (input.kind === "EMPLOYEE_RESPONSE") {
        employeeAction();
        if (state !== "ACTIVE")
          throw new BadRequestException("Plan is not active");
      } else if (input.kind === "REVIEW_MEETING") {
        managerAction();
        if (state !== "ACTIVE")
          throw new BadRequestException("Plan is not active");
        if (
          !input.occurredOn ||
          input.occurredOn < dateOnly(plan.starts_on) ||
          input.occurredOn > dateOnly(plan.ends_on) ||
          input.occurredOn > today
        )
          throw new BadRequestException(
            "Meeting date must be within the plan and not future-dated",
          );
      } else if (input.kind === "SUPPORT_UPDATE") {
        managerAction();
        if (state !== "ACTIVE")
          throw new BadRequestException("Plan is not active");
      } else if (input.kind === "DECISION") {
        hrAction();
        if (state !== "ACTIVE")
          throw new BadRequestException("Plan is not active");
        if (p.userId === plan.created_by)
          throw new ForbiddenException(
            "The plan author cannot decide its outcome",
          );
        if (!input.outcome || !input.evidenceReference)
          throw new BadRequestException(
            "Decision needs an outcome and evidence reference",
          );
        if (today < dateOnly(plan.starts_on))
          throw new BadRequestException("Plan has not started");
        const prerequisites = await client.query<{ kind: string }>(
          "SELECT DISTINCT kind FROM improvement_plan_events WHERE tenant_id=$1 AND plan_id=$2 AND kind IN ('EMPLOYEE_RESPONSE','REVIEW_MEETING')",
          [p.tenantId, id],
        );
        if (
          !prerequisites.rows.some(
            (event) => event.kind === "EMPLOYEE_RESPONSE",
          ) ||
          !prerequisites.rows.some((event) => event.kind === "REVIEW_MEETING")
        )
          throw new BadRequestException(
            "Decision requires an employee response and a review meeting",
          );
      } else if (input.kind === "APPEAL") {
        employeeAction();
        if (state !== "DECIDED")
          throw new BadRequestException("Plan is not awaiting appeal");
      } else if (input.kind === "APPEAL_RESOLUTION") {
        hrAction();
        if (state !== "APPEALED")
          throw new BadRequestException("Plan has no open appeal");
        if (p.userId === plan.created_by || p.userId === plan.decided_by)
          throw new ForbiddenException(
            "An independent HR actor must resolve the appeal",
          );
        if (!input.outcome || !input.evidenceReference)
          throw new BadRequestException(
            "Appeal resolution needs an outcome and evidence reference",
          );
      } else {
        hrAction();
        if (state !== "DECIDED")
          throw new BadRequestException("Plan is not awaiting closure");
        if (p.userId === plan.created_by || p.userId === plan.decided_by)
          throw new ForbiddenException(
            "An independent HR actor must close the plan",
          );
        if (
          !input.policyReference ||
          !input.occurredOn ||
          input.occurredOn > today ||
          (plan.decided_at && input.occurredOn < dateOnly(plan.decided_at))
        )
          throw new BadRequestException(
            "Closure needs a past appeal deadline and its policy reference",
          );
      }
      const event = await client.query<{ id: string; kind: string }>(
        "INSERT INTO improvement_plan_events(tenant_id,plan_id,kind,note,occurred_on,outcome,evidence_reference,policy_reference,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,kind",
        [
          p.tenantId,
          id,
          input.kind,
          input.note,
          input.occurredOn ?? null,
          input.outcome ?? null,
          input.evidenceReference ?? null,
          input.policyReference ?? null,
          p.userId,
        ],
      );
      if (input.kind === "ACTIVATED")
        await client.query(
          "UPDATE improvement_plans SET status='ACTIVE',activated_by=$3,activated_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, p.userId],
        );
      if (input.kind === "DECISION")
        await client.query(
          "UPDATE improvement_plans SET status='DECIDED',decision=$3,decided_by=$4,decided_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, input.outcome, p.userId],
        );
      if (input.kind === "APPEAL")
        await client.query(
          "UPDATE improvement_plans SET status='APPEALED' WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id],
        );
      if (input.kind === "APPEAL_RESOLUTION")
        await client.query(
          "UPDATE improvement_plans SET status='CLOSED',final_decision=$3,closed_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, input.outcome],
        );
      if (input.kind === "CLOSED")
        await client.query(
          "UPDATE improvement_plans SET status='CLOSED',final_decision=decision,closed_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id],
        );
      const created = event.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ImprovementPlanEventRecorded",
        "improvement_plan_event",
        created.id,
        { planId: id, kind: input.kind },
      );
      return created;
    });
  }
}
