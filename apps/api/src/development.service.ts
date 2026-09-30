import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  developmentActionEventInput,
  developmentActionInput,
} from "@hpi/contracts";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database, type SqlClient } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues.map((issue) => issue.message),
    );
  return parsed.data;
}

function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

type ActionAccess = {
  id: string;
  employee_id: string;
  manager_id: string | null;
  status: string;
};

@Injectable()
export class DevelopmentService {
  constructor(private readonly db: Database) {}

  private async access(
    client: SqlClient,
    p: Principal,
    id: string,
    lock = false,
  ): Promise<ActionAccess> {
    const row = await client.query<ActionAccess>(
      `SELECT a.id,a.employee_id,a.status,u.manager_id FROM development_actions a JOIN users u ON u.tenant_id=a.tenant_id AND u.id=a.employee_id WHERE a.tenant_id=$1 AND a.id=$2${lock ? " FOR UPDATE OF a" : ""}`,
      [p.tenantId, id],
    );
    const action = row.rows[0];
    if (!action) throw new NotFoundException("Development action not found");
    if (!canSeeEmployee(p, action.employee_id, action.manager_id))
      throw new ForbiddenException("Action outside access scope");
    return action;
  }

  async list(p: Principal, employeeId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const rows = await client.query(
        "SELECT a.id,a.employee_id,a.cycle_id,c.name AS cycle_name,a.goal_id,a.competency_gap,a.current_level,a.target_level,a.activity,a.training,a.mentor_id,a.stretch_assignment,a.due_date,a.status,a.created_at,a.completed_at FROM development_actions a JOIN cycles c ON c.tenant_id=a.tenant_id AND c.id=a.cycle_id WHERE a.tenant_id=$1 AND a.employee_id=$2 ORDER BY a.due_date,a.created_at DESC LIMIT 200",
        [p.tenantId, employeeId],
      );
      return { actions: rows.rows };
    });
  }

  async detail(p: Principal, actionId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      await this.access(client, p, actionId);
      const row = await client.query(
        "SELECT a.*,c.name AS cycle_name FROM development_actions a JOIN cycles c ON c.tenant_id=a.tenant_id AND c.id=a.cycle_id WHERE a.tenant_id=$1 AND a.id=$2",
        [p.tenantId, actionId],
      );
      const events = await client.query(
        "SELECT id,kind,note,evidence_reference,actor_id,created_at FROM development_action_events WHERE tenant_id=$1 AND action_id=$2 ORDER BY created_at,id LIMIT 500",
        [p.tenantId, actionId],
      );
      return { ...row.rows[0], events: events.rows };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(developmentActionInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, input.employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, input.employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const cycle = await client.query<{
        purpose: string;
        starts_on: string | Date;
        ends_on: string | Date;
      }>(
        "SELECT purpose,starts_on,ends_on FROM cycles WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, input.cycleId],
      );
      if (!cycle.rows[0]) throw new NotFoundException("Cycle not found");
      if (cycle.rows[0].purpose !== "DEVELOPMENT")
        throw new BadRequestException(
          "Development actions require a development cycle",
        );
      const startsOn = dateOnly(cycle.rows[0].starts_on);
      const endsOn = dateOnly(cycle.rows[0].ends_on);
      if (endsOn < new Date().toISOString().slice(0, 10))
        throw new BadRequestException(
          "Development actions cannot start after a cycle ends",
        );
      if (input.dueDate < startsOn || input.dueDate > endsOn)
        throw new BadRequestException(
          "Development action due date must be inside the cycle",
        );
      if (input.goalId) {
        const goal = await client.query(
          "SELECT 1 FROM goals WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND cycle_id=$4 AND purpose='DEVELOPMENT'",
          [p.tenantId, input.goalId, input.employeeId, input.cycleId],
        );
        if (!goal.rows[0])
          throw new BadRequestException(
            "Linked goal must belong to the employee and development cycle",
          );
      }
      if (input.mentorId) {
        const mentor = await client.query(
          "SELECT 1 FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
          [p.tenantId, input.mentorId],
        );
        if (!mentor.rows[0])
          throw new BadRequestException(
            "Mentor must be an active tenant member",
          );
      }
      const row = await client.query<{ id: string; status: string }>(
        "INSERT INTO development_actions(tenant_id,employee_id,cycle_id,goal_id,competency_gap,current_level,target_level,activity,training,mentor_id,stretch_assignment,due_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,status",
        [
          p.tenantId,
          input.employeeId,
          input.cycleId,
          input.goalId ?? null,
          input.competencyGap,
          input.currentLevel,
          input.targetLevel,
          input.activity,
          input.training ?? null,
          input.mentorId ?? null,
          input.stretchAssignment ?? null,
          input.dueDate,
          p.userId,
        ],
      );
      const created = row.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "DevelopmentActionCreated",
        "development_action",
        created.id,
        { employeeId: input.employeeId, cycleId: input.cycleId },
      );
      return created;
    });
  }

  async recordEvent(
    p: Principal,
    actionId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const input = parse(developmentActionEventInput, body);
    if (input.kind !== "PROGRESS")
      requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    if (
      input.kind === "COMPLETED" &&
      (!input.evidenceReference || input.evidenceReference.length < 5)
    )
      throw new BadRequestException(
        "Completion requires an evidence reference",
      );
    return this.db.tenant(p.tenantId, async (client) => {
      const action = await this.access(client, p, actionId, true);
      if (["COMPLETED", "CANCELLED"].includes(action.status))
        throw new BadRequestException(
          "Closed development actions cannot be changed",
        );
      const event = await client.query<{ id: string; kind: string }>(
        "INSERT INTO development_action_events(tenant_id,action_id,kind,note,evidence_reference,actor_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,kind",
        [
          p.tenantId,
          actionId,
          input.kind,
          input.note,
          input.evidenceReference ?? null,
          p.userId,
        ],
      );
      if (input.kind === "PROGRESS" && action.status === "PLANNED")
        await client.query(
          "UPDATE development_actions SET status='IN_PROGRESS' WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, actionId],
        );
      if (input.kind === "COMPLETED")
        await client.query(
          "UPDATE development_actions SET status='COMPLETED',completed_at=now() WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, actionId],
        );
      if (input.kind === "CANCELLED")
        await client.query(
          "UPDATE development_actions SET status='CANCELLED' WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, actionId],
        );
      const created = event.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "DevelopmentActionEventRecorded",
        "development_action_event",
        created.id,
        { actionId, kind: input.kind },
      );
      return created;
    });
  }
}
