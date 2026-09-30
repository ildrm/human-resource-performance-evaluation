import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { governanceCaseEventInput, governanceCaseInput } from "@hpi/contracts";
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

type CaseAccess = {
  id: string;
  employee_id: string;
  manager_id: string | null;
  status: string;
  reported_by: string;
  triaged_by: string | null;
  decided_by: string | null;
};

@Injectable()
export class GovernanceService {
  constructor(private readonly db: Database) {}

  private async access(
    client: SqlClient,
    p: Principal,
    id: string,
    lock = false,
  ): Promise<CaseAccess> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const result = await client.query<CaseAccess>(
      `SELECT g.id,g.employee_id,u.manager_id,g.status,g.reported_by,g.triaged_by,g.decided_by FROM governance_cases g JOIN users u ON u.tenant_id=g.tenant_id AND u.id=g.employee_id WHERE g.tenant_id=$1 AND g.id=$2${lock ? " FOR UPDATE OF g" : ""}`,
      [p.tenantId, id],
    );
    const record = result.rows[0];
    if (!record) throw new NotFoundException("Governance case not found");
    if (
      !canSeeEmployee(p, record.employee_id, record.manager_id) ||
      (p.role === "EMPLOYEE" && record.status === "REPORTED")
    )
      throw new ForbiddenException("Governance case outside access scope");
    return record;
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
        "SELECT id,employee_id,event_type,occurred_on,description,status,created_at FROM governance_cases WHERE tenant_id=$1 AND employee_id=$2 AND ($3::text<>'EMPLOYEE' OR status<>'REPORTED') ORDER BY created_at DESC LIMIT 200",
        [p.tenantId, employeeId, p.role],
      );
      return { cases: result.rows };
    });
  }

  async detail(p: Principal, id: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      await this.access(client, p, id);
      const record = await client.query(
        "SELECT id,employee_id,event_type,occurred_on,description,initial_evidence_reference,status,reported_by,triaged_by,decided_by,resolved_by,created_at,triaged_at,decided_at,resolved_at FROM governance_cases WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, id],
      );
      const events = await client.query(
        "SELECT id,kind,note,evidence_reference,policy_basis,actor_id,created_at FROM governance_case_events WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at,id LIMIT 500",
        [p.tenantId, id],
      );
      return { ...record.rows[0], events: events.rows };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(governanceCaseInput, body);
    if (input.occurredOn > new Date().toISOString().slice(0, 10))
      throw new BadRequestException("Incident date cannot be in the future");
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, input.employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, input.employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const result = await client.query<{ id: string; status: string }>(
        "INSERT INTO governance_cases(tenant_id,employee_id,event_type,occurred_on,description,initial_evidence_reference,reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,status",
        [
          p.tenantId,
          input.employeeId,
          input.eventType,
          input.occurredOn,
          input.description,
          input.evidenceReference,
          p.userId,
        ],
      );
      const created = result.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "GovernanceCaseReported",
        "governance_case",
        created.id,
        { employeeId: input.employeeId, eventType: input.eventType },
      );
      return created;
    });
  }

  async record(p: Principal, id: string, body: unknown): Promise<unknown> {
    const input = parse(governanceCaseEventInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const record = await this.access(client, p, id, true);
      const hrAction = () => requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
      if (input.kind === "EMPLOYEE_RESPONSE") {
        requireRole(p, "EMPLOYEE");
        if (p.userId !== record.employee_id)
          throw new ForbiddenException("Only the employee can respond");
        if (record.status !== "TRIAGED")
          throw new BadRequestException("Case is not awaiting a response");
      } else if (input.kind === "TRIAGE") {
        hrAction();
        if (record.status !== "REPORTED")
          throw new BadRequestException("Case is not awaiting triage");
        if (p.userId === record.reported_by)
          throw new ForbiddenException(
            "An independent HR actor must triage the case",
          );
      } else if (input.kind === "CONFIRM" || input.kind === "REJECT") {
        hrAction();
        if (record.status !== "TRIAGED")
          throw new BadRequestException("Case is not awaiting a finding");
        if (p.userId === record.reported_by || p.userId === record.triaged_by)
          throw new ForbiddenException(
            "An independent HR actor must make the finding",
          );
        if (!input.evidenceReference || !input.policyBasis)
          throw new BadRequestException(
            "Finding needs an evidence reference and policy basis",
          );
        if (input.kind === "CONFIRM") {
          const response = await client.query(
            "SELECT 1 FROM governance_case_events WHERE tenant_id=$1 AND case_id=$2 AND kind='EMPLOYEE_RESPONSE' LIMIT 1",
            [p.tenantId, id],
          );
          if (!response.rows[0])
            throw new BadRequestException(
              "Employee response is required before confirmation",
            );
        }
      } else {
        hrAction();
        if (record.status !== "CONFIRMED")
          throw new BadRequestException(
            "Only a confirmed case can be resolved",
          );
        if (p.userId === record.reported_by || p.userId === record.decided_by)
          throw new ForbiddenException(
            "An independent HR actor must resolve the case",
          );
        if (!input.evidenceReference || !input.policyBasis)
          throw new BadRequestException(
            "Resolution needs an evidence reference and policy basis",
          );
      }
      if (input.kind !== "EMPLOYEE_RESPONSE")
        await client.query(
          "SELECT id FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [p.tenantId, record.employee_id],
        );
      const event = await client.query<{ id: string; kind: string }>(
        "INSERT INTO governance_case_events(tenant_id,case_id,kind,note,evidence_reference,policy_basis,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,kind",
        [
          p.tenantId,
          id,
          input.kind,
          input.note,
          input.evidenceReference ?? null,
          input.policyBasis ?? null,
          p.userId,
        ],
      );
      if (input.kind === "TRIAGE")
        await client.query(
          "UPDATE governance_cases SET status='TRIAGED',triaged_by=$3,triaged_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, p.userId],
        );
      if (input.kind === "CONFIRM")
        await client.query(
          "UPDATE governance_cases SET status='CONFIRMED',decided_by=$3,decided_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, p.userId],
        );
      if (input.kind === "REJECT")
        await client.query(
          "UPDATE governance_cases SET status='REJECTED',decided_by=$3,decided_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, p.userId],
        );
      if (input.kind === "RESOLVE")
        await client.query(
          "UPDATE governance_cases SET status='RESOLVED',resolved_by=$3,resolved_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, id, p.userId],
        );
      const created = event.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "GovernanceCaseEventRecorded",
        "governance_case_event",
        created.id,
        { caseId: id, kind: input.kind },
      );
      return created;
    });
  }
}
