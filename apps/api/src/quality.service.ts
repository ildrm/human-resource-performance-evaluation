import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { evidenceQualityPolicyInput } from "@hpi/contracts";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database } from "./db.js";
import { requireRole, type Principal } from "./security.js";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException(
      parsed.error.issues.map((issue) => issue.message),
    );
  return parsed.data;
}

@Injectable()
export class QualityService {
  constructor(private readonly db: Database) {}

  async policies(p: Principal): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "AUDITOR");
    return this.db.tenant(p.tenantId, async (client) => {
      const rows = await client.query(
        "SELECT id,version,freshness_days,unreferenced_evidence_factor::text,weights,rationale,state,created_by,activated_by,activated_at FROM evidence_quality_policies WHERE tenant_id=$1 ORDER BY version DESC",
        [p.tenantId],
      );
      return { policies: rows.rows };
    });
  }

  async createPolicy(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(evidenceQualityPolicyInput, body);
    const weights = Object.values(input.weights).map(
      (weight) => new Decimal(weight),
    );
    if (
      weights.some((weight) => weight.lte(0)) ||
      !weights.reduce((sum, weight) => sum.plus(weight), new Decimal(0)).eq(1)
    )
      throw new BadRequestException("Positive EQI weights must sum to 1");
    const factor = new Decimal(input.unreferencedEvidenceFactor);
    if (factor.lt(0) || factor.gt(1))
      throw new BadRequestException("Unreferenced factor must be in [0,1]");
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query<{
        id: string;
        state: string;
        version: number;
      }>(
        "INSERT INTO evidence_quality_policies(tenant_id,version,freshness_days,unreferenced_evidence_factor,weights,rationale,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,state,version",
        [
          p.tenantId,
          input.version,
          input.freshnessDays,
          input.unreferencedEvidenceFactor,
          JSON.stringify(input.weights),
          input.rationale,
          p.userId,
        ],
      );
      const created = row.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvidenceQualityPolicyCreated",
        "evidence_quality_policy",
        created.id,
      );
      return created;
    });
  }

  async activatePolicy(
    p: Principal,
    policyId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(
      z.object({ reviewReference: z.string().trim().min(10).max(1000) }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query<{ created_by: string }>(
        "SELECT created_by FROM evidence_quality_policies WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' FOR UPDATE",
        [p.tenantId, policyId],
      );
      if (!row.rows[0]) throw new NotFoundException("Draft policy not found");
      if (row.rows[0].created_by === p.userId)
        throw new ForbiddenException(
          "Policy activation requires another reviewer",
        );
      await client.query(
        "UPDATE evidence_quality_policies SET state='RETIRED' WHERE tenant_id=$1 AND state='ACTIVE'",
        [p.tenantId],
      );
      const activated = await client.query(
        "UPDATE evidence_quality_policies SET state='ACTIVE',activated_by=$3,activated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,state,version",
        [p.tenantId, policyId, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvidenceQualityPolicyActivated",
        "evidence_quality_policy",
        policyId,
        {},
        input.reviewReference,
      );
      return activated.rows[0];
    });
  }
}
