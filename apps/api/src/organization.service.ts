import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  endOrganizationAssignmentInput,
  organizationAssignmentInput,
  organizationUnitInput,
} from "@hpi/contracts";
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

type Unit = {
  id: string;
  effective_from: string;
  effective_to: string | null;
};

@Injectable()
export class OrganizationService {
  constructor(private readonly db: Database) {}

  async units(p: Principal): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    return this.db.tenant(p.tenantId, async (client) => {
      const result = await client.query(
        "SELECT u.id,u.code,u.name,u.kind,u.parent_id,p.name AS parent_name,u.effective_from,u.effective_to FROM organization_units u LEFT JOIN organization_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id WHERE u.tenant_id=$1 ORDER BY u.code,u.effective_from LIMIT 500",
        [p.tenantId],
      );
      return { units: result.rows };
    });
  }

  async createUnit(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(organizationUnitInput, body);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new BadRequestException("Unit end date precedes start date");
    return this.db.tenant(p.tenantId, async (client) => {
      await client.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
        p.tenantId,
      ]);
      if (input.parentId) {
        const parent = await client.query<Unit>(
          "SELECT id,effective_from::text,effective_to::text FROM organization_units WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, input.parentId],
        );
        const row = parent.rows[0];
        if (!row) throw new NotFoundException("Parent unit not found");
        if (
          row.effective_from > input.effectiveFrom ||
          (row.effective_to !== null &&
            (!input.effectiveTo || row.effective_to < input.effectiveTo))
        )
          throw new BadRequestException(
            "Parent unit must cover the child's effective period",
          );
      }
      const overlap = await client.query(
        "SELECT id FROM organization_units WHERE tenant_id=$1 AND code=$2 AND effective_from<=coalesce($4::date,'infinity'::date) AND coalesce(effective_to,'infinity'::date)>=$3::date LIMIT 1",
        [
          p.tenantId,
          input.code,
          input.effectiveFrom,
          input.effectiveTo ?? null,
        ],
      );
      if (overlap.rows[0])
        throw new BadRequestException("Unit code has an overlapping version");
      const result = await client.query(
        "INSERT INTO organization_units(tenant_id,code,name,kind,parent_id,effective_from,effective_to,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          p.tenantId,
          input.code,
          input.name,
          input.kind,
          input.parentId ?? null,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          p.userId,
        ],
      );
      const created = result.rows[0];
      await audit(
        client,
        p.tenantId,
        p.userId,
        "OrganizationUnitCreated",
        "organization_unit",
        created.id,
        { code: input.code, kind: input.kind },
      );
      return created;
    });
  }

  async history(p: Principal, employeeId: string): Promise<unknown> {
    requireRole(
      p,
      "TENANT_ADMIN",
      "HR_ADMIN",
      "MANAGER",
      "EMPLOYEE",
      "CALIBRATOR",
      "AUDITOR",
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const result = await client.query(
        "SELECT a.id,a.unit_id,u.code,u.name AS unit_name,u.kind,u.parent_id,a.assignment_role,a.effective_from,a.effective_to,a.reason,a.created_at FROM employee_org_assignments a JOIN organization_units u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id WHERE a.tenant_id=$1 AND a.employee_id=$2 ORDER BY a.effective_from DESC,a.created_at DESC LIMIT 500",
        [p.tenantId, employeeId],
      );
      return { assignments: result.rows };
    });
  }

  private async lockPerson(
    client: SqlClient,
    p: Principal,
    employeeId: string,
  ): Promise<void> {
    const person = await client.query(
      "SELECT id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true FOR UPDATE",
      [p.tenantId, employeeId],
    );
    if (!person.rows[0]) throw new NotFoundException("Employee not found");
  }

  async assign(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(organizationAssignmentInput, body);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new BadRequestException("Assignment end date precedes start date");
    return this.db.tenant(p.tenantId, async (client) => {
      await this.lockPerson(client, p, input.employeeId);
      const unit = await client.query<Unit>(
        "SELECT id,effective_from::text,effective_to::text FROM organization_units WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, input.unitId],
      );
      const target = unit.rows[0];
      if (!target) throw new NotFoundException("Organization unit not found");
      if (
        target.effective_from > input.effectiveFrom ||
        (target.effective_to !== null &&
          (!input.effectiveTo || target.effective_to < input.effectiveTo))
      )
        throw new BadRequestException("Unit must cover the assignment period");
      if (input.assignmentRole === "PRIMARY") {
        const overlap = await client.query(
          "SELECT id FROM employee_org_assignments WHERE tenant_id=$1 AND employee_id=$2 AND assignment_role='PRIMARY' AND effective_from<=coalesce($4::date,'infinity'::date) AND coalesce(effective_to,'infinity'::date)>=$3::date LIMIT 1",
          [
            p.tenantId,
            input.employeeId,
            input.effectiveFrom,
            input.effectiveTo ?? null,
          ],
        );
        if (overlap.rows[0])
          throw new BadRequestException(
            "Primary assignment overlaps an existing period",
          );
      }
      const result = await client.query(
        "INSERT INTO employee_org_assignments(tenant_id,employee_id,unit_id,assignment_role,effective_from,effective_to,reason,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          p.tenantId,
          input.employeeId,
          input.unitId,
          input.assignmentRole,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.reason,
          p.userId,
        ],
      );
      const created = result.rows[0];
      await client.query(
        "INSERT INTO employee_org_assignment_events(tenant_id,assignment_id,kind,effective_to,reason,actor_id) VALUES ($1,$2,'CREATED',$3,$4,$5)",
        [
          p.tenantId,
          created.id,
          input.effectiveTo ?? null,
          input.reason,
          p.userId,
        ],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "OrganizationAssignmentCreated",
        "organization_assignment",
        created.id,
        {
          employeeId: input.employeeId,
          unitId: input.unitId,
          role: input.assignmentRole,
        },
        input.reason,
      );
      return created;
    });
  }

  async endAssignment(
    p: Principal,
    assignmentId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(endOrganizationAssignmentInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const lookup = await client.query<{ employee_id: string }>(
        "SELECT employee_id FROM employee_org_assignments WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, assignmentId],
      );
      if (!lookup.rows[0]) throw new NotFoundException("Assignment not found");
      await this.lockPerson(client, p, lookup.rows[0].employee_id);
      const row = await client.query<{
        effective_from: string;
        effective_to: string | null;
      }>(
        "SELECT effective_from::text,effective_to::text FROM employee_org_assignments WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [p.tenantId, assignmentId],
      );
      const old = row.rows[0]!;
      if (
        input.effectiveTo < old.effective_from ||
        (old.effective_to !== null && input.effectiveTo >= old.effective_to)
      )
        throw new BadRequestException(
          "End date must shorten the existing assignment period",
        );
      const updated = await client.query(
        "UPDATE employee_org_assignments SET effective_to=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [p.tenantId, assignmentId, input.effectiveTo],
      );
      await client.query(
        "INSERT INTO employee_org_assignment_events(tenant_id,assignment_id,kind,effective_to,reason,actor_id) VALUES ($1,$2,'ENDED',$3,$4,$5)",
        [p.tenantId, assignmentId, input.effectiveTo, input.reason, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "OrganizationAssignmentEnded",
        "organization_assignment",
        assignmentId,
        { effectiveTo: input.effectiveTo },
        input.reason,
      );
      return updated.rows[0];
    });
  }
}
