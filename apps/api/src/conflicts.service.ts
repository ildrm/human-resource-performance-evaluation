import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  reviewConflictInput,
  reviewConflictResolutionInput,
} from "@hpi/contracts";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database, type SqlClient } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

export type ReviewStage = "SUBMISSION" | "CALIBRATION" | "PUBLICATION";

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}

function eligible(
  stage: ReviewStage,
  role: string,
  managerId: string | null,
  actorId: string,
): boolean {
  if (stage === "SUBMISSION")
    return (
      ["TENANT_ADMIN", "HR_ADMIN"].includes(role) ||
      (role === "MANAGER" && managerId === actorId)
    );
  if (stage === "CALIBRATION")
    return ["TENANT_ADMIN", "CALIBRATOR"].includes(role);
  return ["TENANT_ADMIN", "HR_ADMIN"].includes(role);
}

/** Called only while holding the evaluation row lock in the review action transaction. */
export async function assertReviewConflictClear(
  client: SqlClient,
  tenantId: string,
  evaluationId: string,
  stage: ReviewStage,
  actorId: string,
): Promise<void> {
  const result = await client.query<{
    status: string;
    declared_by: string;
    replacement_actor_id: string | null;
  }>(
    "SELECT status,declared_by,replacement_actor_id FROM review_conflicts WHERE tenant_id=$1 AND evaluation_id=$2 AND stage=$3 ORDER BY resolved_at DESC NULLS LAST,created_at DESC",
    [tenantId, evaluationId, stage],
  );
  if (result.rows.some((row) => row.status === "OPEN"))
    throw new BadRequestException(
      "Review action is held by an unresolved conflict declaration",
    );
  if (result.rows.some((row) => row.declared_by === actorId))
    throw new ForbiddenException(
      "A conflicted actor cannot perform this review action",
    );
  const latest = result.rows.find((row) => row.status === "RESOLVED");
  if (latest && latest.replacement_actor_id !== actorId)
    throw new ForbiddenException(
      "Review action is assigned to the approved replacement actor",
    );
}

export async function assertNoOpenReviewConflicts(
  client: SqlClient,
  tenantId: string,
  evaluationId: string,
): Promise<void> {
  const open = await client.query(
    "SELECT 1 FROM review_conflicts WHERE tenant_id=$1 AND evaluation_id=$2 AND status='OPEN' LIMIT 1",
    [tenantId, evaluationId],
  );
  if (open.rows[0])
    throw new BadRequestException(
      "Publication is held by an unresolved review conflict",
    );
}

type EvaluationAccess = {
  employee_id: string;
  manager_id: string | null;
  status: string;
  submitted_by: string | null;
};

@Injectable()
export class ConflictsService {
  constructor(private readonly db: Database) {}

  private async evaluation(
    client: SqlClient,
    p: Principal,
    evaluationId: string,
    lock: boolean,
  ): Promise<EvaluationAccess> {
    const result = await client.query<EvaluationAccess>(
      `SELECT e.employee_id,u.manager_id,e.status,e.submitted_by FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id WHERE e.tenant_id=$1 AND e.id=$2${lock ? " FOR UPDATE OF e" : ""}`,
      [p.tenantId, evaluationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Evaluation not found");
    if (!canSeeEmployee(p, row.employee_id, row.manager_id))
      throw new ForbiddenException("Evaluation outside access scope");
    return row;
  }

  async list(p: Principal, evaluationId: string): Promise<unknown> {
    requireRole(
      p,
      "TENANT_ADMIN",
      "HR_ADMIN",
      "MANAGER",
      "CALIBRATOR",
      "AUDITOR",
    );
    return this.db.tenant(p.tenantId, async (client) => {
      await this.evaluation(client, p, evaluationId, false);
      const rows = await client.query(
        "SELECT c.id,c.stage,c.category,c.reason,c.declared_by,d.name AS declarer_name,c.status,c.replacement_actor_id,r.name AS replacement_name,c.resolution_note,c.resolved_by,c.created_at,c.resolved_at FROM review_conflicts c JOIN users d ON d.tenant_id=c.tenant_id AND d.id=c.declared_by LEFT JOIN users r ON r.tenant_id=c.tenant_id AND r.id=c.replacement_actor_id WHERE c.tenant_id=$1 AND c.evaluation_id=$2 ORDER BY c.created_at DESC LIMIT 100",
        [p.tenantId, evaluationId],
      );
      return { conflicts: rows.rows };
    });
  }

  async declare(
    p: Principal,
    evaluationId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "CALIBRATOR");
    const input = parse(reviewConflictInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const evaluation = await this.evaluation(client, p, evaluationId, true);
      if (!eligible(input.stage, p.role, evaluation.manager_id, p.userId))
        throw new ForbiddenException(
          "Actor is not eligible for this review stage",
        );
      if (p.userId === evaluation.employee_id)
        throw new ForbiddenException(
          "Subject cannot declare a reviewer conflict",
        );
      const expected =
        input.stage === "SUBMISSION" ? "CALCULATED" : "SUBMITTED";
      if (evaluation.status !== expected)
        throw new BadRequestException(
          "Conflict declaration is outside the active review stage",
        );
      const existing = await client.query(
        "SELECT 1 FROM review_conflicts WHERE tenant_id=$1 AND evaluation_id=$2 AND stage=$3 AND declared_by=$4 LIMIT 1",
        [p.tenantId, evaluationId, input.stage, p.userId],
      );
      if (existing.rows[0])
        throw new BadRequestException(
          "Actor has already declared this conflict",
        );
      const created = await client.query(
        "INSERT INTO review_conflicts(tenant_id,evaluation_id,stage,category,reason,declared_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          p.tenantId,
          evaluationId,
          input.stage,
          input.category,
          input.reason,
          p.userId,
        ],
      );
      const row = created.rows[0];
      await client.query(
        "INSERT INTO review_conflict_events(tenant_id,conflict_id,kind,note,actor_id) VALUES ($1,$2,'DECLARED',$3,$4)",
        [p.tenantId, row.id, input.reason, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ReviewConflictDeclared",
        "review_conflict",
        row.id,
        { evaluationId, stage: input.stage, category: input.category },
      );
      return row;
    });
  }

  async resolve(
    p: Principal,
    conflictId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(reviewConflictResolutionInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const lookup = await client.query<{ evaluation_id: string }>(
        "SELECT evaluation_id FROM review_conflicts WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, conflictId],
      );
      if (!lookup.rows[0]) throw new NotFoundException("Conflict not found");
      const evaluation = await this.evaluation(
        client,
        p,
        lookup.rows[0].evaluation_id,
        true,
      );
      const conflict = await client.query<{
        stage: ReviewStage;
        status: string;
        declared_by: string;
      }>(
        "SELECT stage,status,declared_by FROM review_conflicts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [p.tenantId, conflictId],
      );
      const old = conflict.rows[0]!;
      if (old.status !== "OPEN")
        throw new BadRequestException("Conflict already resolved");
      if (old.declared_by === p.userId)
        throw new ForbiddenException(
          "Conflict requires an independent resolver",
        );
      if (
        p.userId === evaluation.employee_id ||
        p.userId === evaluation.submitted_by
      )
        throw new ForbiddenException(
          "Subject or submitter cannot resolve a review conflict",
        );
      const expected = old.stage === "SUBMISSION" ? "CALCULATED" : "SUBMITTED";
      if (evaluation.status !== expected)
        throw new BadRequestException(
          "Conflict resolution is outside the active review stage",
        );
      if (
        [p.userId, old.declared_by, evaluation.employee_id].includes(
          input.replacementActorId,
        )
      )
        throw new ForbiddenException(
          "Replacement must be separate from resolver, declarer, and subject",
        );
      const replacement = await client.query<{ role: string }>(
        "SELECT role FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, input.replacementActorId],
      );
      const person = replacement.rows[0];
      if (
        !person ||
        !eligible(
          old.stage,
          person.role,
          evaluation.manager_id,
          input.replacementActorId,
        )
      )
        throw new BadRequestException(
          "Replacement actor is not eligible for this review stage",
        );
      if (
        old.stage === "CALIBRATION" &&
        evaluation.submitted_by === input.replacementActorId
      )
        throw new BadRequestException(
          "Submitter cannot replace the calibrator",
        );
      if (
        old.stage === "PUBLICATION" &&
        evaluation.submitted_by === input.replacementActorId
      )
        throw new BadRequestException("Submitter cannot replace the publisher");
      const priorDisclosure = await client.query(
        "SELECT 1 FROM review_conflicts WHERE tenant_id=$1 AND evaluation_id=$2 AND stage=$3 AND declared_by=$4 LIMIT 1",
        [
          p.tenantId,
          lookup.rows[0].evaluation_id,
          old.stage,
          input.replacementActorId,
        ],
      );
      if (priorDisclosure.rows[0])
        throw new BadRequestException(
          "Replacement has already declared a conflict at this stage",
        );
      const updated = await client.query(
        "UPDATE review_conflicts SET status='RESOLVED',replacement_actor_id=$3,resolution_note=$4,resolved_by=$5,resolved_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [
          p.tenantId,
          conflictId,
          input.replacementActorId,
          input.resolutionNote,
          p.userId,
        ],
      );
      await client.query(
        "INSERT INTO review_conflict_events(tenant_id,conflict_id,kind,note,actor_id) VALUES ($1,$2,'RESOLVED',$3,$4)",
        [p.tenantId, conflictId, input.resolutionNote, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ReviewConflictResolved",
        "review_conflict",
        conflictId,
        { replacementActorId: input.replacementActorId },
        input.resolutionNote,
      );
      return updated.rows[0];
    });
  }
}
