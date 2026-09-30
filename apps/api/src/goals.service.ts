import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { goalCheckinInput, goalInput, goalRevisionInput } from "@hpi/contracts";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database, type SqlClient } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

type GoalAccess = {
  id: string;
  employee_id: string;
  manager_id: string | null;
};

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues.map((issue) => issue.message),
    );
  return parsed.data;
}

function checkWeight(weight: string | undefined): void {
  if (
    weight !== undefined &&
    (new Decimal(weight).lt(0) || new Decimal(weight).gt(1))
  )
    throw new BadRequestException("Goal weight must be between 0 and 1");
}

function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

@Injectable()
export class GoalsService {
  constructor(private readonly db: Database) {}

  private async access(
    client: SqlClient,
    p: Principal,
    id: string,
  ): Promise<GoalAccess> {
    const row = await client.query<GoalAccess>(
      "SELECT g.id,g.employee_id,u.manager_id FROM goals g JOIN users u ON u.tenant_id=g.tenant_id AND u.id=g.employee_id WHERE g.tenant_id=$1 AND g.id=$2",
      [p.tenantId, id],
    );
    const goal = row.rows[0];
    if (!goal) throw new NotFoundException("Goal not found");
    if (!canSeeEmployee(p, goal.employee_id, goal.manager_id))
      throw new ForbiddenException("Goal outside access scope");
    return goal;
  }

  private async dependencies(
    client: SqlClient,
    p: Principal,
    employeeId: string,
    cycleId: string,
    ids: string[],
    currentId?: string,
  ): Promise<void> {
    if (
      new Set(ids).size !== ids.length ||
      (currentId && ids.includes(currentId))
    )
      throw new BadRequestException(
        "Goal dependencies must be unique and cannot reference self",
      );
    if (ids.length === 0) return;
    const rows = await client.query<{ id: string }>(
      "SELECT id FROM goals WHERE tenant_id=$1 AND employee_id=$2 AND cycle_id=$3 AND id=ANY($4::uuid[])",
      [p.tenantId, employeeId, cycleId, ids],
    );
    if (rows.rows.length !== ids.length)
      throw new BadRequestException(
        "Dependencies must belong to the same employee and cycle",
      );
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
        "SELECT g.id,g.employee_id,g.cycle_id,g.purpose,g.kind,g.created_at,c.name AS cycle_name,r.version,r.description,r.target,r.due_date,r.status,r.review_cadence,r.effective_at FROM goals g JOIN cycles c ON c.tenant_id=g.tenant_id AND c.id=g.cycle_id JOIN LATERAL (SELECT version,description,target,due_date,status,review_cadence,effective_at FROM goal_revisions WHERE tenant_id=g.tenant_id AND goal_id=g.id AND effective_at<=now() ORDER BY effective_at DESC LIMIT 1) r ON true WHERE g.tenant_id=$1 AND g.employee_id=$2 ORDER BY r.due_date,g.created_at DESC LIMIT 200",
        [p.tenantId, employeeId],
      );
      return { goals: rows.rows };
    });
  }

  async detail(p: Principal, goalId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      await this.access(client, p, goalId);
      const goal = await client.query(
        "SELECT g.id,g.employee_id,g.cycle_id,g.purpose,g.kind,g.created_by,g.created_at,c.name AS cycle_name FROM goals g JOIN cycles c ON c.tenant_id=g.tenant_id AND c.id=g.cycle_id WHERE g.tenant_id=$1 AND g.id=$2",
        [p.tenantId, goalId],
      );
      const revisions = await client.query(
        "SELECT version,effective_at,description,baseline,threshold,target,stretch,due_date,priority,weight::text,review_cadence,dependencies,status,reason,created_by,created_at FROM goal_revisions WHERE tenant_id=$1 AND goal_id=$2 ORDER BY version",
        [p.tenantId, goalId],
      );
      const checkins = await client.query(
        "SELECT id,actor_id,progress,obstacle,support_needed,evidence_reference,next_action,created_at FROM goal_checkins WHERE tenant_id=$1 AND goal_id=$2 ORDER BY created_at,id LIMIT 200",
        [p.tenantId, goalId],
      );
      return {
        ...goal.rows[0],
        revisions: revisions.rows,
        checkins: checkins.rows,
      };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(goalInput, body);
    checkWeight(input.weight);
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
        starts_on: string;
        ends_on: string;
      }>(
        "SELECT purpose,starts_on,ends_on FROM cycles WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, input.cycleId],
      );
      if (!cycle.rows[0]) throw new NotFoundException("Cycle not found");
      const cycleStart = dateOnly(cycle.rows[0].starts_on);
      const cycleEnd = dateOnly(cycle.rows[0].ends_on);
      if (cycleEnd < new Date().toISOString().slice(0, 10))
        throw new BadRequestException(
          "Goals cannot be created after the cycle ends",
        );
      if (input.dueDate < cycleStart || input.dueDate > cycleEnd)
        throw new BadRequestException("Goal due date must be inside the cycle");
      await this.dependencies(
        client,
        p,
        input.employeeId,
        input.cycleId,
        input.dependencies,
      );
      const row = await client.query<{ id: string }>(
        "INSERT INTO goals(tenant_id,employee_id,cycle_id,purpose,kind,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          p.tenantId,
          input.employeeId,
          input.cycleId,
          cycle.rows[0].purpose,
          input.kind,
          p.userId,
        ],
      );
      const id = row.rows[0]!.id;
      await client.query(
        "INSERT INTO goal_revisions(tenant_id,goal_id,version,effective_at,description,baseline,threshold,target,stretch,due_date,priority,weight,review_cadence,dependencies,status,reason,created_by) VALUES ($1,$2,1,now(),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        [
          p.tenantId,
          id,
          input.description,
          input.baseline,
          input.threshold,
          input.target,
          input.stretch,
          input.dueDate,
          input.priority,
          input.weight ?? null,
          input.reviewCadence,
          JSON.stringify(input.dependencies),
          input.status,
          input.reason,
          p.userId,
        ],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "GoalCreated",
        "goal",
        id,
        { purpose: cycle.rows[0].purpose, kind: input.kind, version: 1 },
        input.reason,
      );
      return { id, version: 1, purpose: cycle.rows[0].purpose };
    });
  }

  async revise(p: Principal, goalId: string, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(goalRevisionInput, body);
    checkWeight(input.weight);
    if (new Date(input.effectiveAt).getTime() < Date.now())
      throw new BadRequestException(
        "Goal revisions must take effect prospectively",
      );
    return this.db.tenant(p.tenantId, async (client) => {
      const goal = await this.access(client, p, goalId);
      const row = await client.query<{
        cycle_id: string;
        starts_on: string;
        ends_on: string;
      }>(
        "SELECT g.cycle_id,c.starts_on,c.ends_on FROM goals g JOIN cycles c ON c.tenant_id=g.tenant_id AND c.id=g.cycle_id WHERE g.tenant_id=$1 AND g.id=$2 FOR UPDATE OF g",
        [p.tenantId, goalId],
      );
      const cycleStart = dateOnly(row.rows[0]!.starts_on);
      const cycleEnd = dateOnly(row.rows[0]!.ends_on);
      if (input.effectiveAt.slice(0, 10) > cycleEnd)
        throw new BadRequestException(
          "Goal revision cannot take effect after the cycle ends",
        );
      if (input.dueDate < cycleStart || input.dueDate > cycleEnd)
        throw new BadRequestException("Goal due date must be inside the cycle");
      const latest = await client.query<{
        version: number;
        effective_at: Date;
      }>(
        "SELECT version,effective_at FROM goal_revisions WHERE tenant_id=$1 AND goal_id=$2 ORDER BY version DESC LIMIT 1",
        [p.tenantId, goalId],
      );
      const previous = latest.rows[0]!;
      if (previous.version !== input.expectedVersion)
        throw new ConflictException(
          "Goal version changed; reload before revising",
        );
      if (
        new Date(input.effectiveAt).getTime() <=
        new Date(previous.effective_at).getTime()
      )
        throw new BadRequestException(
          "Effective time must follow the preceding revision",
        );
      await this.dependencies(
        client,
        p,
        goal.employee_id,
        row.rows[0]!.cycle_id,
        input.dependencies,
        goalId,
      );
      const version = previous.version + 1;
      await client.query(
        "INSERT INTO goal_revisions(tenant_id,goal_id,version,effective_at,description,baseline,threshold,target,stretch,due_date,priority,weight,review_cadence,dependencies,status,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
        [
          p.tenantId,
          goalId,
          version,
          input.effectiveAt,
          input.description,
          input.baseline,
          input.threshold,
          input.target,
          input.stretch,
          input.dueDate,
          input.priority,
          input.weight ?? null,
          input.reviewCadence,
          JSON.stringify(input.dependencies),
          input.status,
          input.reason,
          p.userId,
        ],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "GoalRevised",
        "goal",
        goalId,
        { version, effectiveAt: input.effectiveAt },
        input.reason,
      );
      return { id: goalId, version, effectiveAt: input.effectiveAt };
    });
  }

  async checkin(p: Principal, goalId: string, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const input = parse(goalCheckinInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      await this.access(client, p, goalId);
      const row = await client.query<{ id: string; created_at: Date }>(
        "INSERT INTO goal_checkins(tenant_id,goal_id,actor_id,progress,obstacle,support_needed,evidence_reference,next_action) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at",
        [
          p.tenantId,
          goalId,
          p.userId,
          input.progress,
          input.obstacle ?? null,
          input.supportNeeded ?? null,
          input.evidenceReference ?? null,
          input.nextAction,
        ],
      );
      const created = row.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "GoalCheckinRecorded",
        "goal_checkin",
        created.id,
        { goalId },
      );
      return created;
    });
  }
}
