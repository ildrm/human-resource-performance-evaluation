import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { contextRecordInput, contextReviewInput } from "@hpi/contracts";
import { Decimal } from "decimal.js";
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

type ContextAccess = {
  id: string;
  employee_id: string;
  manager_id: string | null;
  status: string;
  created_by: string;
};

@Injectable()
export class ContextService {
  constructor(private readonly db: Database) {}

  async cycles(p: Principal, employeeId: string): Promise<unknown> {
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
        "SELECT id,name,purpose FROM cycles WHERE tenant_id=$1 ORDER BY starts_on DESC LIMIT 100",
        [p.tenantId],
      );
      return { cycles: result.rows };
    });
  }

  private async access(
    client: SqlClient,
    p: Principal,
    id: string,
    lock = false,
  ): Promise<ContextAccess> {
    const result = await client.query<ContextAccess>(
      `SELECT r.id,r.employee_id,u.manager_id,r.status,r.created_by FROM context_records r JOIN users u ON u.tenant_id=r.tenant_id AND u.id=r.employee_id WHERE r.tenant_id=$1 AND r.id=$2${lock ? " FOR UPDATE OF r" : ""}`,
      [p.tenantId, id],
    );
    const record = result.rows[0];
    if (!record) throw new NotFoundException("Context record not found");
    if (!canSeeEmployee(p, record.employee_id, record.manager_id))
      throw new ForbiddenException("Context record outside access scope");
    return record;
  }

  async list(
    p: Principal,
    employeeId: string,
    cycleId?: string,
  ): Promise<unknown> {
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
        "SELECT r.id,r.employee_id,r.cycle_id,c.name AS cycle_name,r.kind,r.description,r.impact,r.evidence_reference,r.expected_exposure::text,r.actual_exposure::text,r.exposure_unit,r.status,r.created_at FROM context_records r JOIN cycles c ON c.tenant_id=r.tenant_id AND c.id=r.cycle_id WHERE r.tenant_id=$1 AND r.employee_id=$2 AND ($3::uuid IS NULL OR r.cycle_id=$3) ORDER BY r.created_at DESC LIMIT 200",
        [p.tenantId, employeeId, cycleId ?? null],
      );
      return { records: result.rows };
    });
  }

  async detail(p: Principal, id: string): Promise<unknown> {
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
      await this.access(client, p, id);
      const record = await client.query(
        "SELECT r.id,r.employee_id,r.cycle_id,c.name AS cycle_name,r.kind,r.description,r.impact,r.evidence_reference,r.expected_exposure::text,r.actual_exposure::text,r.exposure_unit,r.status,r.created_by,r.reviewed_by,r.reviewed_at,r.created_at FROM context_records r JOIN cycles c ON c.tenant_id=r.tenant_id AND c.id=r.cycle_id WHERE r.tenant_id=$1 AND r.id=$2",
        [p.tenantId, id],
      );
      const review = await client.query(
        "SELECT decision,note,evidence_reference,reviewer_id,created_at FROM context_reviews WHERE tenant_id=$1 AND context_id=$2",
        [p.tenantId, id],
      );
      return { ...record.rows[0], review: review.rows[0] ?? null };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const input = parse(contextRecordInput, body);
    const exposure = [
      input.expectedExposure,
      input.actualExposure,
      input.exposureUnit,
    ];
    if (
      exposure.some((value) => value !== undefined) &&
      exposure.some((value) => value === undefined)
    )
      throw new BadRequestException(
        "Expected and actual exposure require a shared unit",
      );
    if (
      input.expectedExposure !== undefined &&
      (new Decimal(input.expectedExposure).lt(0) ||
        new Decimal(input.actualExposure!).lt(0))
    )
      throw new BadRequestException("Exposure counts must be nonnegative");
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query<{ manager_id: string | null }>(
        "SELECT manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true FOR UPDATE",
        [p.tenantId, input.employeeId],
      );
      if (!person.rows[0]) throw new NotFoundException("Employee not found");
      if (!canSeeEmployee(p, input.employeeId, person.rows[0].manager_id))
        throw new ForbiddenException("Employee outside access scope");
      const cycle = await client.query(
        "SELECT 1 FROM cycles WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, input.cycleId],
      );
      if (!cycle.rows[0]) throw new NotFoundException("Cycle not found");
      const result = await client.query<{ id: string; status: string }>(
        "INSERT INTO context_records(tenant_id,employee_id,cycle_id,kind,description,impact,evidence_reference,expected_exposure,actual_exposure,exposure_unit,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status",
        [
          p.tenantId,
          input.employeeId,
          input.cycleId,
          input.kind,
          input.description,
          input.impact,
          input.evidenceReference,
          input.expectedExposure ?? null,
          input.actualExposure ?? null,
          input.exposureUnit ?? null,
          p.userId,
        ],
      );
      const created = result.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ContextRecordSubmitted",
        "context_record",
        created.id,
        {
          employeeId: input.employeeId,
          cycleId: input.cycleId,
          kind: input.kind,
        },
      );
      return created;
    });
  }

  async review(p: Principal, id: string, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(contextReviewInput, body);
    if (input.decision === "VERIFIED" && !input.evidenceReference)
      throw new BadRequestException("Verification needs an evidence reference");
    return this.db.tenant(p.tenantId, async (client) => {
      const record = await this.access(client, p, id, true);
      if (record.status !== "SUBMITTED")
        throw new BadRequestException("Context record was already reviewed");
      if (p.userId === record.created_by)
        throw new ForbiddenException(
          "An independent actor must review context",
        );
      await client.query(
        "SELECT id FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [p.tenantId, record.employee_id],
      );
      const review = await client.query<{ id: string; decision: string }>(
        "INSERT INTO context_reviews(tenant_id,context_id,decision,note,evidence_reference,reviewer_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,decision",
        [
          p.tenantId,
          id,
          input.decision,
          input.note,
          input.evidenceReference ?? null,
          p.userId,
        ],
      );
      await client.query(
        "UPDATE context_records SET status=$3,reviewed_by=$4,reviewed_at=now() WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, id, input.decision, p.userId],
      );
      const created = review.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ContextRecordReviewed",
        "context_review",
        created.id,
        { contextId: id, decision: input.decision },
      );
      return created;
    });
  }
}
