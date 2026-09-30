import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  calculateV2,
  calculateEvidenceQuality,
  interpolate,
  replayVersioned,
  CURRENT_ENGINE_VERSION,
  CURRENT_INPUT_SCHEMA_VERSION,
  type EvidenceQualityInput,
  type EvidenceQualityMetric,
  type EvidenceQualityPolicy,
  type EvidenceQualityResult,
  type EvaluationInput,
  type MetricInput,
  type PeriodAggregation,
  type ScoringObservation,
  type VersionedEvaluationInput,
} from "@hpi/calculation-engine";
import {
  appealInput,
  cycleInput,
  evidenceInput,
  jobInput,
  metricInput,
  personInput,
  targetInput,
  templateInput,
  templateRetirementInput,
  templateValidationInput,
} from "@hpi/contracts";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { audit, verifyAuditChain } from "./audit.js";
import {
  currentEngineArtifactHash,
  snapshotHash,
} from "./engine-provenance.js";
import { Database, type SqlClient } from "./db.js";
import {
  assertNoOpenReviewConflicts,
  assertReviewConflictClear,
} from "./conflicts.service.js";
import { logTimedOperation } from "./telemetry.js";
import {
  canSeeEmployee,
  hashPassword,
  requireRole,
  type Principal,
} from "./security.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  return result.data;
}

function mustExist<T>(row: T | undefined): T {
  if (!row) throw new NotFoundException("Record not found");
  return row;
}

function reportCursor(
  value: string | undefined,
): { day: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { day?: unknown; id?: unknown };
    if (
      typeof parsed.day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.day) &&
      typeof parsed.id === "string" &&
      z.uuid().safeParse(parsed.id).success
    )
      return { day: parsed.day, id: parsed.id };
  } catch {
    // A malformed cursor is a client error.
  }
  throw new BadRequestException("Invalid report cursor");
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly db: Database) {}

  async overview(p: Principal): Promise<Record<string, unknown>> {
    return this.db.tenant(p.tenantId, async (client) => {
      const person = await client.query(
        "SELECT id,name,email,role,manager_id,job_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, p.userId],
      );
      const evaluations = await client.query(
        "SELECT e.id,e.employee_id,u.name AS employee_name,c.name AS cycle_name,e.status,e.score,e.created_at FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id WHERE e.tenant_id=$1 AND ($2::text IN ('TENANT_ADMIN','HR_ADMIN','CALIBRATOR','AUDITOR') OR ($2='MANAGER' AND u.manager_id=$3) OR (e.employee_id=$3 AND e.status IN ('PUBLISHED','ACKNOWLEDGED','APPEALED'))) ORDER BY e.created_at DESC LIMIT 100",
        [p.tenantId, p.role, p.employeeId],
      );
      return {
        person: mustExist(person.rows[0]),
        evaluations: evaluations.rows,
      };
    });
  }

  async catalog(p: Principal): Promise<Record<string, unknown>> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "CALIBRATOR");
    return this.db.tenant(p.tenantId, async (client) => {
      const [users, jobs, metrics, templates, targets, cycles] =
        await Promise.all([
          client.query(
            "SELECT id,name,email,role,manager_id,job_id FROM users WHERE tenant_id=$1 AND active=true AND ($2::text<>'MANAGER' OR id=$3 OR manager_id=$3) ORDER BY name LIMIT 200",
            [p.tenantId, p.role, p.userId],
          ),
          client.query(
            "SELECT * FROM jobs WHERE tenant_id=$1 ORDER BY name,version DESC LIMIT 200",
            [p.tenantId],
          ),
          client.query(
            "SELECT * FROM metrics WHERE tenant_id=$1 ORDER BY code LIMIT 200",
            [p.tenantId],
          ),
          client.query(
            "SELECT * FROM templates WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200",
            [p.tenantId],
          ),
          client.query(
            "SELECT * FROM targets WHERE tenant_id=$1 AND ($2::text<>'MANAGER' OR employee_id IS NULL OR employee_id=$3 OR employee_id IN (SELECT id FROM users WHERE tenant_id=$1 AND manager_id=$3)) ORDER BY created_at DESC LIMIT 200",
            [p.tenantId, p.role, p.userId],
          ),
          client.query(
            "SELECT * FROM cycles WHERE tenant_id=$1 ORDER BY starts_on DESC LIMIT 100",
            [p.tenantId],
          ),
        ]);
      return {
        users: users.rows,
        jobs: jobs.rows,
        metrics: metrics.rows,
        templates: templates.rows,
        targets: targets.rows,
        cycles: cycles.rows,
      };
    });
  }

  async createPerson(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(personInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "INSERT INTO users(tenant_id,email,name,password_hash,role,manager_id,job_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,email,name,role,manager_id,job_id",
        [
          p.tenantId,
          input.email.toLowerCase(),
          input.name,
          hashPassword(input.password),
          input.role,
          input.managerId ?? null,
          input.jobId ?? null,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "PersonCreated",
        "user",
        created.id,
      );
      return created;
    });
  }

  async createJob(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(jobInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "INSERT INTO jobs(tenant_id,name,family,purpose,version,approved) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          p.tenantId,
          input.name,
          input.family,
          input.purpose,
          input.version,
          input.approved,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "JobCreated",
        "job",
        created.id,
      );
      return created;
    });
  }

  async createMetric(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(metricInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "INSERT INTO metrics(tenant_id,code,name,construct,unit,measurement_kind,direction,rationale,limitations,controllability,minimum_sample,guardrail_metric_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",
        [
          p.tenantId,
          input.code,
          input.name,
          input.construct,
          input.unit,
          input.measurementKind,
          input.direction,
          input.rationale,
          input.limitations,
          input.controllability,
          input.minimumSample,
          input.guardrailMetricId ?? null,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "MetricCreated",
        "metric",
        created.id,
      );
      return created;
    });
  }

  async createTemplate(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(templateInput, body);
    for (const dimension of input.dimensions) {
      if (
        !dimension.metrics
          .reduce((sum, metric) => sum.plus(metric.weight), new Decimal(0))
          .eq(1)
      )
        throw new BadRequestException("Metric weights must sum to 1");
    }
    if (
      !input.dimensions
        .reduce((sum, dimension) => sum.plus(dimension.weight), new Decimal(0))
        .eq(1)
    )
      throw new BadRequestException("Dimension weights must sum to 1");
    return this.db.tenant(p.tenantId, async (client) => {
      const job = await client.query(
        "SELECT approved FROM jobs WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, input.jobId],
      );
      if (!job.rows[0]?.approved)
        throw new BadRequestException("Job model requires approval");
      const ids = input.dimensions.flatMap((d) =>
        d.metrics.map((m) => m.metricId),
      );
      if (new Set(ids).size !== ids.length)
        throw new BadRequestException("A metric may appear only once");
      const metrics = await client.query(
        "SELECT id FROM metrics WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [p.tenantId, ids],
      );
      if (metrics.rowCount !== ids.length)
        throw new BadRequestException("Metric does not belong to tenant");
      const row = await client.query(
        "INSERT INTO templates(tenant_id,job_id,name,version,effective_from,dimensions,created_by,scientific_rationale,limitations,engine_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          p.tenantId,
          input.jobId,
          input.name,
          input.version,
          input.effectiveFrom,
          JSON.stringify(input.dimensions),
          p.userId,
          input.scientificRationale,
          input.limitations,
          CURRENT_ENGINE_VERSION,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateCreated",
        "template",
        created.id,
      );
      return created;
    });
  }

  async reviewTemplate(p: Principal, templateId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE templates SET state='REVIEW',reviewed_by=$3,reviewed_at=now() WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' AND created_by=$3 RETURNING *",
        [p.tenantId, templateId, p.userId],
      );
      const reviewed = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateSubmittedForReview",
        "template",
        templateId,
      );
      return reviewed;
    });
  }

  async validateTemplate(
    p: Principal,
    templateId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "CALIBRATOR");
    const input = parse(templateValidationInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE templates SET state='VALIDATED',validated_by=$3,validated_at=now(),validation_note=$4,fixture_evidence_reference=$5 WHERE tenant_id=$1 AND id=$2 AND state='REVIEW' AND created_by<>$3 RETURNING *",
        [
          p.tenantId,
          templateId,
          p.userId,
          input.validationNote,
          input.fixtureEvidenceReference,
        ],
      );
      if (!row.rows[0])
        throw new ForbiddenException(
          "Template validation requires an independent reviewer and review state",
        );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateValidated",
        "template",
        templateId,
        { fixtureEvidenceReference: input.fixtureEvidenceReference },
        input.validationNote,
      );
      return row.rows[0];
    });
  }

  async approveTemplate(p: Principal, templateId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE templates SET state='APPROVED',approved_by=$3,approved_at=now() WHERE tenant_id=$1 AND id=$2 AND state='VALIDATED' AND created_by<>$3 AND validated_by<>$3 RETURNING *",
        [p.tenantId, templateId, p.userId],
      );
      if (!row.rows[0])
        throw new ForbiddenException(
          "Template approval requires an actor independent of author and validator",
        );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateApproved",
        "template",
        templateId,
      );
      return row.rows[0];
    });
  }

  async activateTemplate(p: Principal, templateId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE templates SET state='ACTIVE' WHERE tenant_id=$1 AND id=$2 AND state='APPROVED' AND approved_by IS NOT NULL AND validated_by IS NOT NULL RETURNING *",
        [p.tenantId, templateId],
      );
      const activated = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateActivated",
        "template",
        templateId,
      );
      return activated;
    });
  }

  async retireTemplate(
    p: Principal,
    templateId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(templateRetirementInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE templates SET state='RETIRED',retired_by=$3,retired_at=now(),retirement_reason=$4 WHERE tenant_id=$1 AND id=$2 AND state='ACTIVE' RETURNING *",
        [p.tenantId, templateId, p.userId, input.reason],
      );
      const retired = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TemplateRetired",
        "template",
        templateId,
        {},
        input.reason,
      );
      return retired;
    });
  }

  async createTarget(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(targetInput, body);
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom)
      throw new BadRequestException("Target end precedes start");
    return this.db.tenant(p.tenantId, async (client) => {
      const metric = await client.query<{
        direction: MetricInput["direction"];
      }>("SELECT direction FROM metrics WHERE tenant_id=$1 AND id=$2", [
        p.tenantId,
        input.metricId,
      ]);
      const direction = mustExist(metric.rows[0]).direction;
      interpolate(input.target, input.anchors, direction);
      if (
        direction === "HIGHER" &&
        !(
          new Decimal(input.critical).lt(input.threshold) &&
          new Decimal(input.threshold).lt(input.target) &&
          new Decimal(input.target).lt(input.stretch)
        )
      )
        throw new BadRequestException(
          "Higher-is-better target anchors must increase",
        );
      if (
        direction === "LOWER" &&
        !(
          new Decimal(input.critical).gt(input.threshold) &&
          new Decimal(input.threshold).gt(input.target) &&
          new Decimal(input.target).gt(input.stretch)
        )
      )
        throw new BadRequestException(
          "Lower-is-better target anchors must decrease",
        );
      const existing = await client.query<{
        id: string;
        effective_from: string;
        effective_to: string | null;
      }>(
        "SELECT id,effective_from::text,effective_to::text FROM targets WHERE tenant_id=$1 AND metric_id=$2 AND employee_id IS NOT DISTINCT FROM $3::uuid AND daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]') && daterange($4::date,coalesce($5::date,'infinity'::date),'[]') FOR UPDATE",
        [
          p.tenantId,
          input.metricId,
          input.employeeId ?? null,
          input.effectiveFrom,
          input.effectiveTo ?? null,
        ],
      );
      for (const prior of existing.rows) {
        if (
          prior.effective_to !== null ||
          prior.effective_from >= input.effectiveFrom
        )
          throw new BadRequestException("Target effective periods overlap");
        await client.query(
          "UPDATE targets SET effective_to=$3::date - 1 WHERE tenant_id=$1 AND id=$2",
          [p.tenantId, prior.id, input.effectiveFrom],
        );
        await audit(
          client,
          p.tenantId,
          p.userId,
          "TargetClosed",
          "target",
          prior.id,
          { supersededFrom: input.effectiveFrom },
          input.reason,
        );
      }
      const version = await client.query<{ version: number }>(
        "SELECT coalesce(max(version),0)+1 AS version FROM targets WHERE tenant_id=$1 AND metric_id=$2 AND employee_id IS NOT DISTINCT FROM $3::uuid",
        [p.tenantId, input.metricId, input.employeeId ?? null],
      );
      const row = await client.query(
        "INSERT INTO targets(tenant_id,metric_id,employee_id,version,effective_from,effective_to,critical,threshold,target,stretch,anchors,reason,approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
        [
          p.tenantId,
          input.metricId,
          input.employeeId ?? null,
          version.rows[0]!.version,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.critical,
          input.threshold,
          input.target,
          input.stretch,
          JSON.stringify(input.anchors),
          input.reason,
          p.userId,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "TargetCreated",
        "target",
        created.id,
        {},
        input.reason,
      );
      return created;
    });
  }

  async createCycle(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(cycleInput, body);
    if (input.endsOn < input.startsOn)
      throw new BadRequestException("Cycle end precedes start");
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "INSERT INTO cycles(tenant_id,name,starts_on,ends_on,purpose) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [p.tenantId, input.name, input.startsOn, input.endsOn, input.purpose],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "CycleCreated",
        "cycle",
        created.id,
      );
      return created;
    });
  }

  private async accessiblePerson(
    client: SqlClient,
    p: Principal,
    employeeId: string,
  ): Promise<void> {
    const result = await client.query<{
      id: string;
      manager_id: string | null;
    }>(
      "SELECT id,manager_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
      [p.tenantId, employeeId],
    );
    const person = mustExist(result.rows[0]);
    if (!canSeeEmployee(p, person.id, person.manager_id))
      throw new ForbiddenException("Employee outside access scope");
  }

  async addEvidence(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE");
    const input = parse(evidenceInput, body);
    if (
      (input.dataState === "OBSERVED" || input.dataState === "ZERO") !==
      (input.value !== undefined)
    )
      throw new BadRequestException("Value presence must match data state");
    if (
      input.dataState === "ZERO" &&
      (input.value === undefined || !new Decimal(input.value).eq(0))
    )
      throw new BadRequestException("ZERO requires actual value 0");
    if (
      !["OBSERVED", "ZERO"].includes(input.dataState) &&
      (input.numerator !== undefined || input.denominator !== undefined)
    )
      throw new BadRequestException("Counts require an observed value");
    return this.db.tenant(p.tenantId, async (client) => {
      await this.accessiblePerson(client, p, input.employeeId);
      const metricResult = await client.query<{
        measurement_kind: "CONTINUOUS" | "BINOMIAL_PROPORTION";
      }>("SELECT measurement_kind FROM metrics WHERE tenant_id=$1 AND id=$2", [
        p.tenantId,
        input.metricId,
      ]);
      const metric = mustExist(metricResult.rows[0]);
      if (metric.measurement_kind === "BINOMIAL_PROPORTION") {
        const observed = ["OBSERVED", "ZERO"].includes(input.dataState);
        if (
          observed !==
          (input.numerator !== undefined && input.denominator !== undefined)
        )
          throw new BadRequestException(
            "Observed binary proportions require numerator and denominator; other states cannot contain counts",
          );
        if (observed) {
          const numerator = new Decimal(input.numerator!);
          const denominator = new Decimal(input.denominator!);
          const value = new Decimal(input.value!);
          if (
            !numerator.isInteger() ||
            !denominator.isInteger() ||
            numerator.lt(0) ||
            denominator.lte(0) ||
            numerator.gt(denominator)
          )
            throw new BadRequestException(
              "Binary proportions require integer 0 <= numerator <= denominator",
            );
          if (
            value.minus(numerator.div(denominator).mul(100)).abs().gt("0.005")
          )
            throw new BadRequestException(
              "Percent value must match numerator / denominator within 0.005 percentage points",
            );
        }
      } else if (
        (input.numerator === undefined) !==
        (input.denominator === undefined)
      ) {
        throw new BadRequestException(
          "Numerator and denominator must be supplied together",
        );
      }
      const row = await client.query(
        "INSERT INTO evidence(tenant_id,employee_id,metric_id,observed_at,value,data_state,source,external_ref,note,numerator,denominator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,employee_id,metric_id,observed_at,data_state,verification_state",
        [
          p.tenantId,
          input.employeeId,
          input.metricId,
          input.observedAt,
          input.value ?? null,
          input.dataState,
          input.source,
          input.externalRef ?? null,
          input.note ?? null,
          input.numerator ?? null,
          input.denominator ?? null,
        ],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvidenceSubmitted",
        "evidence",
        created.id,
      );
      return created;
    });
  }

  async verifyEvidence(
    p: Principal,
    evidenceId: string,
    accept: boolean,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    return this.db.tenant(p.tenantId, async (client) => {
      const old = await client.query<{
        employee_id: string;
        manager_id: string | null;
      }>(
        "SELECT e.employee_id,u.manager_id FROM evidence e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.verification_state='PENDING'",
        [p.tenantId, evidenceId],
      );
      const record = mustExist(old.rows[0]);
      if (p.role === "MANAGER" && record.manager_id !== p.employeeId)
        throw new ForbiddenException();
      if (record.employee_id === p.employeeId)
        throw new ForbiddenException("Cannot verify own evidence");
      const row = await client.query(
        "UPDATE evidence SET verification_state=$3,verified_by=$4,verified_at=now() WHERE tenant_id=$1 AND id=$2 AND verification_state='PENDING' RETURNING id,verification_state",
        [p.tenantId, evidenceId, accept ? "VERIFIED" : "REJECTED", p.userId],
      );
      const verified = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        accept ? "EvidenceVerified" : "EvidenceRejected",
        "evidence",
        evidenceId,
      );
      return verified;
    });
  }

  async evidenceFor(p: Principal, employeeId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      await this.accessiblePerson(client, p, employeeId);
      const result = await client.query(
        "SELECT e.id,e.employee_id,e.metric_id,m.name AS metric_name,m.measurement_kind,e.observed_at,e.value,e.data_state,e.source,e.note,e.numerator,e.denominator,e.verification_state FROM evidence e JOIN metrics m ON m.tenant_id=e.tenant_id AND m.id=e.metric_id WHERE e.tenant_id=$1 AND e.employee_id=$2 ORDER BY e.observed_at DESC LIMIT 200",
        [p.tenantId, employeeId],
      );
      return result.rows;
    });
  }

  async calculateEvaluation(
    p: Principal,
    employeeId: string,
    cycleId: string,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const started = performance.now();
    return this.db.tenant(p.tenantId, async (client) => {
      const personResult = await client.query<{
        id: string;
        name: string;
        manager_id: string | null;
        job_id: string | null;
      }>(
        "SELECT id,name,manager_id,job_id FROM users WHERE tenant_id=$1 AND id=$2 AND active=true",
        [p.tenantId, employeeId],
      );
      const person = mustExist(personResult.rows[0]);
      if (p.role === "MANAGER" && person.manager_id !== p.employeeId)
        throw new ForbiddenException();
      if (!person.job_id)
        throw new BadRequestException("Employee has no job assignment");
      const jobResult = await client.query<{
        name: string;
        family: string;
        version: number;
      }>("SELECT name,family,version FROM jobs WHERE tenant_id=$1 AND id=$2", [
        p.tenantId,
        person.job_id,
      ]);
      const job = mustExist(jobResult.rows[0]);
      const personSnapshot = {
        id: person.id,
        name: person.name,
        managerId: person.manager_id,
        jobId: person.job_id,
        jobName: job.name,
        jobFamily: job.family,
        jobVersion: job.version,
      };
      const cycleResult = await client.query<{
        id: string;
        starts_on: string;
        ends_on: string;
      }>(
        "SELECT id,starts_on::text,ends_on::text FROM cycles WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, cycleId],
      );
      const cycle = mustExist(cycleResult.rows[0]);
      const prior = await client.query<{ id: string; status: string }>(
        "SELECT id,status FROM evaluations WHERE tenant_id=$1 AND employee_id=$2 AND cycle_id=$3 FOR UPDATE",
        [p.tenantId, employeeId, cycleId],
      );
      if (
        prior.rows[0] &&
        !["INCOMPLETE", "CALCULATED"].includes(prior.rows[0].status)
      )
        throw new BadRequestException(
          "Submitted or published evaluation cannot be recalculated",
        );
      const templateResult = await client.query<{
        id: string;
        version: number;
        dimensions: {
          name: string;
          weight: string;
          missingWeightPolicy?: {
            version: number;
            mode: "BLOCK" | "REDISTRIBUTE";
          };
          metrics: {
            metricId: string;
            weight: string;
            required: boolean;
            periodAggregation?: PeriodAggregation;
            minimumObservations?: number;
          }[];
        }[];
      }>(
        "SELECT id,version,dimensions FROM templates WHERE tenant_id=$1 AND job_id=$2 AND state='ACTIVE' AND effective_from<=$3::date ORDER BY effective_from DESC,version DESC LIMIT 1",
        [p.tenantId, person.job_id, cycle.starts_on],
      );
      const template = mustExist(templateResult.rows[0]);
      const qualityPolicyResult = await client.query<{
        id: string;
        version: number;
        freshness_days: number;
        unreferenced_evidence_factor: string;
        weights: EvidenceQualityPolicy["weights"];
      }>(
        "SELECT id,version,freshness_days,unreferenced_evidence_factor::text,weights FROM evidence_quality_policies WHERE tenant_id=$1 AND state='ACTIVE' LIMIT 1",
        [p.tenantId],
      );
      const qualityPolicy = qualityPolicyResult.rows[0];
      const qualityMetrics: EvidenceQualityMetric[] = [];
      const metricIds = template.dimensions.flatMap((dimension) =>
        dimension.metrics.map((metric) => metric.metricId),
      );
      const definitions = await client.query<{
        id: string;
        name: string;
        direction: MetricInput["direction"];
        minimum_sample: number;
        measurement_kind: "CONTINUOUS" | "BINOMIAL_PROPORTION";
      }>(
        "SELECT id,name,direction,minimum_sample,measurement_kind FROM metrics WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [p.tenantId, metricIds],
      );
      const metricById = new Map(
        definitions.rows.map((metric) => [metric.id, metric]),
      );
      const evidenceRows = await client.query<{
        id: string;
        metric_id: string;
        data_state: MetricInput["state"];
        value: string | null;
        denominator: string | null;
        numerator: string | null;
        observed_at: Date | string;
        external_ref: string | null;
      }>(
        "SELECT id,metric_id,data_state,value::text,numerator::text,denominator::text,observed_at,external_ref FROM evidence WHERE tenant_id=$1 AND employee_id=$2 AND metric_id=ANY($3::uuid[]) AND verification_state='VERIFIED' AND observed_at >= $4::date AND observed_at < ($5::date + interval '1 day') ORDER BY observed_at,id LIMIT 10001",
        [p.tenantId, employeeId, metricIds, cycle.starts_on, cycle.ends_on],
      );
      if (evidenceRows.rows.length > 10000)
        throw new BadRequestException(
          "Observation limit exceeded; use a governed batch calculation",
        );
      const targets = await client.query<{
        id: string;
        metric_id: string;
        employee_id: string | null;
        version: number;
        effective_from: string;
        effective_to: string | null;
        anchors: { actual: string; score: string }[];
      }>(
        "SELECT id,metric_id,employee_id,version,effective_from::text,effective_to::text,anchors FROM targets WHERE tenant_id=$1 AND metric_id=ANY($2::uuid[]) AND (employee_id=$3 OR employee_id IS NULL) AND effective_from<=$4::date AND (effective_to IS NULL OR effective_to>=$5::date) ORDER BY (employee_id IS NOT NULL) DESC,version DESC",
        [p.tenantId, metricIds, employeeId, cycle.ends_on, cycle.starts_on],
      );
      const dimensions: VersionedEvaluationInput["dimensions"][number][] = [];
      for (const dimension of template.dimensions) {
        const metrics: VersionedEvaluationInput["dimensions"][number]["metrics"][number][] =
          [];
        for (const configured of dimension.metrics) {
          const metric = mustExist(metricById.get(configured.metricId));
          const metricEvidence = evidenceRows.rows.filter(
            (row) => row.metric_id === metric.id,
          );
          const evidence = metricEvidence.at(-1);
          qualityMetrics.push({
            metricId: metric.id,
            required: configured.required,
            state: evidence?.data_state ?? "MISSING",
            ...(evidence
              ? { observedAt: new Date(evidence.observed_at).toISOString() }
              : {}),
            externalReferencePresent: Boolean(evidence?.external_ref),
            minimumSample: metric.minimum_sample,
            ...(evidence?.denominator
              ? { denominator: evidence.denominator }
              : {}),
          });
          const observations: ScoringObservation[] = metricEvidence.map(
            (row) => {
              const observedAt = new Date(row.observed_at).toISOString();
              const day = observedAt.slice(0, 10);
              const target = targets.rows.find(
                (candidate) =>
                  candidate.metric_id === metric.id &&
                  candidate.effective_from <= day &&
                  (candidate.effective_to === null ||
                    candidate.effective_to >= day),
              );
              return {
                evidenceId: row.id,
                observedAt,
                state: row.data_state,
                ...(row.value !== null ? { actual: row.value } : {}),
                ...(row.numerator !== null ? { numerator: row.numerator } : {}),
                ...(row.denominator !== null
                  ? { denominator: row.denominator }
                  : {}),
                ...(target
                  ? {
                      targetId: target.id,
                      targetVersion: target.version,
                      anchors: target.anchors,
                    }
                  : {}),
              };
            },
          );
          metrics.push({
            metricId: metric.id,
            metricName: metric.name,
            weight: configured.weight,
            required: configured.required,
            direction: metric.direction,
            measurementKind: metric.measurement_kind,
            minimumSample: metric.minimum_sample,
            periodAggregation: configured.periodAggregation ?? "LATEST",
            minimumObservations: configured.minimumObservations ?? 1,
            observations,
          });
        }
        dimensions.push({
          name: dimension.name,
          weight: dimension.weight,
          missingWeightPolicy: dimension.missingWeightPolicy ?? {
            version: 1,
            mode: "BLOCK",
          },
          metrics,
        });
      }
      const snapshot: VersionedEvaluationInput = {
        engineVersion: CURRENT_ENGINE_VERSION,
        inputSchemaVersion: CURRENT_INPUT_SCHEMA_VERSION,
        formulaVersion: `${template.id}:${template.version}`,
        dimensions,
      };
      const result = calculateV2(snapshot);
      const qualityInput: EvidenceQualityInput | null = qualityPolicy
        ? {
            policy: {
              id: qualityPolicy.id,
              version: qualityPolicy.version,
              freshnessDays: qualityPolicy.freshness_days,
              unreferencedEvidenceFactor:
                qualityPolicy.unreferenced_evidence_factor,
              weights: qualityPolicy.weights,
            },
            cycleEnd: cycle.ends_on,
            metrics: qualityMetrics,
          }
        : null;
      const qualityResult = qualityInput
        ? calculateEvidenceQuality(qualityInput)
        : null;
      const organization = await client.query(
        "SELECT a.id AS assignment_id,a.assignment_role,a.effective_from::text,a.effective_to::text,u.id AS unit_id,u.code,u.name,u.kind,p.id AS parent_id,p.code AS parent_code,p.name AS parent_name FROM employee_org_assignments a JOIN organization_units u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id LEFT JOIN organization_units p ON p.tenant_id=u.tenant_id AND p.id=u.parent_id WHERE a.tenant_id=$1 AND a.employee_id=$2 AND a.effective_from<=$3::date AND (a.effective_to IS NULL OR a.effective_to>=$3::date) ORDER BY a.assignment_role,u.code",
        [p.tenantId, employeeId, cycle.ends_on],
      );
      const saved = await client.query(
        "INSERT INTO evaluations(tenant_id,employee_id,cycle_id,template_id,status,score,final_score,input_snapshot,result_snapshot,quality_input_snapshot,quality_result_snapshot,org_snapshot,engine_version,input_schema_version,engine_artifact_hash,input_hash,result_hash,person_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (tenant_id,employee_id,cycle_id) DO UPDATE SET template_id=excluded.template_id,status=excluded.status,score=excluded.score,final_score=excluded.final_score,input_snapshot=excluded.input_snapshot,result_snapshot=excluded.result_snapshot,quality_input_snapshot=excluded.quality_input_snapshot,quality_result_snapshot=excluded.quality_result_snapshot,org_snapshot=excluded.org_snapshot,engine_version=excluded.engine_version,input_schema_version=excluded.input_schema_version,engine_artifact_hash=excluded.engine_artifact_hash,input_hash=excluded.input_hash,result_hash=excluded.result_hash,person_snapshot=excluded.person_snapshot,created_at=now() WHERE evaluations.status IN ('INCOMPLETE','CALCULATED') RETURNING id,status,score,final_score,result_snapshot,quality_result_snapshot,org_snapshot,person_snapshot",
        [
          p.tenantId,
          employeeId,
          cycleId,
          template.id,
          result.status === "COMPLETE" ? "CALCULATED" : "INCOMPLETE",
          result.score,
          JSON.stringify(snapshot),
          JSON.stringify(result),
          qualityInput ? JSON.stringify(qualityInput) : null,
          qualityResult ? JSON.stringify(qualityResult) : null,
          JSON.stringify(organization.rows),
          CURRENT_ENGINE_VERSION,
          CURRENT_INPUT_SCHEMA_VERSION,
          currentEngineArtifactHash,
          snapshotHash(snapshot),
          snapshotHash(result),
          JSON.stringify(personSnapshot),
        ],
      );
      if (!saved.rows[0])
        throw new BadRequestException(
          "Submitted or published evaluation cannot be recalculated",
        );
      const evaluation = saved.rows[0];
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvaluationCalculated",
        "evaluation",
        evaluation.id,
        { status: evaluation.status, formulaVersion: snapshot.formulaVersion },
      );
      logTimedOperation("evaluation_calculation", started, evaluation.status);
      return evaluation;
    });
  }

  async evaluation(p: Principal, evaluationId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const result = await client.query<{
        employee_id: string;
        cycle_id: string;
        manager_id: string | null;
        status: string;
        validation_dossier_id: string | null;
        final_score: string | null;
      }>(
        "SELECT e.*,u.name AS employee_name,u.manager_id,c.name AS cycle_name,t.name AS template_name FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id JOIN templates t ON t.tenant_id=e.tenant_id AND t.id=e.template_id WHERE e.tenant_id=$1 AND e.id=$2",
        [p.tenantId, evaluationId],
      );
      const record = mustExist(result.rows[0]);
      if (!canSeeEmployee(p, record.employee_id, record.manager_id))
        throw new ForbiddenException();
      if (
        p.employeeId === record.employee_id &&
        !["TENANT_ADMIN", "HR_ADMIN", "CALIBRATOR", "AUDITOR"].includes(
          p.role,
        ) &&
        !["PUBLISHED", "ACKNOWLEDGED", "APPEALED"].includes(record.status)
      )
        throw new ForbiddenException("Review has not been published");
      const appeals = await client.query(
        "SELECT id,reason,statement,state,outcome,resolution,remedy,notice_status,created_at,resolved_at FROM appeals WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at",
        [p.tenantId, evaluationId],
      );
      const amendments = await client.query(
        "SELECT id,appeal_id,previous_effective_score::text,amended_score::text,reason,actor_id,created_at FROM evaluation_amendments WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at,id",
        [p.tenantId, evaluationId],
      );
      const calibration = await client.query(
        "SELECT previous_score,proposed_score,reason,evidence_reference,policy_basis,created_at FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at",
        [p.tenantId, evaluationId],
      );
      const dossier = record.validation_dossier_id
        ? await client.query(
            "SELECT version,intended_interpretation,intended_population,job_analysis_reference,content_evidence_reference,reliability_evidence_or_rationale,criterion_evidence_or_rationale,construct_evidence_or_rationale,fairness_review_reference,limitations,revalidate_on,reviewed_at FROM validation_dossiers WHERE tenant_id=$1 AND id=$2",
            [p.tenantId, record.validation_dossier_id],
          )
        : { rows: [] };
      const context = await client.query(
        "SELECT r.id,r.kind,r.description,r.impact,r.evidence_reference,r.expected_exposure::text,r.actual_exposure::text,r.exposure_unit,r.status,r.created_at,v.note AS review_note,v.evidence_reference AS review_evidence_reference FROM context_records r LEFT JOIN context_reviews v ON v.tenant_id=r.tenant_id AND v.context_id=r.id WHERE r.tenant_id=$1 AND r.employee_id=$2 AND r.cycle_id=$3 ORDER BY r.created_at,r.id LIMIT 200",
        [p.tenantId, record.employee_id, record.cycle_id],
      );
      return {
        ...record,
        appeals: appeals.rows,
        amendments: amendments.rows,
        effective_score:
          (amendments.rows.at(-1) as { amended_score: string } | undefined)
            ?.amended_score ?? record.final_score,
        calibration: calibration.rows,
        model_dossier: dossier.rows[0] ?? null,
        context: context.rows,
      };
    });
  }

  async replay(p: Principal, evaluationId: string): Promise<unknown> {
    const evaluation = (await this.evaluation(p, evaluationId)) as {
      input_snapshot: EvaluationInput | VersionedEvaluationInput;
      result_snapshot: { score: string | null; status: string };
      quality_input_snapshot: EvidenceQualityInput | null;
      quality_result_snapshot: EvidenceQualityResult | null;
      score: string | null;
      engine_version: string | null;
      engine_artifact_hash: string | null;
      input_hash: string | null;
      result_hash: string | null;
    };
    const artifactMatches =
      evaluation.engine_artifact_hash === null ||
      evaluation.engine_artifact_hash === currentEngineArtifactHash;
    const inputHashMatches =
      evaluation.input_hash === null ||
      evaluation.input_hash === snapshotHash(evaluation.input_snapshot);
    const resultHashMatches =
      evaluation.result_hash === null ||
      evaluation.result_hash === snapshotHash(evaluation.result_snapshot);
    const replayed = replayVersioned(evaluation.input_snapshot);
    const qualityReplayed = evaluation.quality_input_snapshot
      ? calculateEvidenceQuality(evaluation.quality_input_snapshot)
      : null;
    const qualityMatches =
      qualityReplayed === null
        ? evaluation.quality_result_snapshot === null
        : qualityReplayed.index === evaluation.quality_result_snapshot?.index &&
          Object.entries(qualityReplayed.components).every(
            ([component, value]) =>
              evaluation.quality_result_snapshot?.components[
                component as keyof EvidenceQualityResult["components"]
              ] === value,
          );
    return {
      matches:
        artifactMatches &&
        inputHashMatches &&
        resultHashMatches &&
        replayed.score === evaluation.result_snapshot.score &&
        replayed.status === evaluation.result_snapshot.status &&
        replayed.score === evaluation.score,
      replayed,
      stored: evaluation.result_snapshot,
      provenance: {
        engineVersion: evaluation.engine_version ?? "1.0.0",
        artifactMatches,
        inputHashMatches,
        resultHashMatches,
        legacyArtifactUnavailable: evaluation.engine_artifact_hash === null,
      },
      qualityMatches,
      qualityReplayed,
      qualityStored: evaluation.quality_result_snapshot,
    };
  }

  async submit(
    p: Principal,
    evaluationId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "MANAGER");
    const input = parse(
      z.object({ managerNote: z.string().trim().min(5).max(5000) }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const existing = await client.query<{
        employee_id: string;
        manager_id: string | null;
      }>(
        "SELECT e.employee_id,u.manager_id FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.status='CALCULATED' FOR UPDATE OF e",
        [p.tenantId, evaluationId],
      );
      const record = mustExist(existing.rows[0]);
      if (p.role === "MANAGER" && record.manager_id !== p.employeeId)
        throw new ForbiddenException();
      if (record.employee_id === p.userId)
        throw new ForbiddenException("Cannot submit your own evaluation");
      await assertReviewConflictClear(
        client,
        p.tenantId,
        evaluationId,
        "SUBMISSION",
        p.userId,
      );
      const updated = await client.query(
        "UPDATE evaluations SET status='SUBMITTED',manager_note=$3,submitted_by=$4 WHERE tenant_id=$1 AND id=$2 RETURNING id,status",
        [p.tenantId, evaluationId, input.managerNote, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvaluationSubmitted",
        "evaluation",
        evaluationId,
      );
      return mustExist(updated.rows[0]);
    });
  }

  async calibrate(
    p: Principal,
    evaluationId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "CALIBRATOR");
    const input = parse(
      z.object({
        proposedScore: z.string().regex(/^\d+(?:\.\d{1,4})?$/),
        reason: z.string().min(10).max(3000),
        evidenceReference: z.string().min(3).max(500),
        policyBasis: z.string().min(3).max(500),
      }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const previous = await client.query<{
        score: string;
        final_score: string;
        employee_id: string;
        submitted_by: string;
      }>(
        "SELECT score::text,final_score::text,employee_id,submitted_by FROM evaluations WHERE tenant_id=$1 AND id=$2 AND status='SUBMITTED' FOR UPDATE",
        [p.tenantId, evaluationId],
      );
      const record = mustExist(previous.rows[0]);
      if (record.submitted_by === p.userId || record.employee_id === p.userId)
        throw new ForbiddenException(
          "Calibration requires an independent reviewer",
        );
      await assertReviewConflictClear(
        client,
        p.tenantId,
        evaluationId,
        "CALIBRATION",
        p.userId,
      );
      if (new Decimal(input.proposedScore).gt(120))
        throw new BadRequestException(
          "Proposed score exceeds configured review range",
        );
      const row = await client.query(
        "INSERT INTO calibration_decisions(tenant_id,evaluation_id,previous_score,proposed_score,reason,evidence_reference,policy_basis,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          p.tenantId,
          evaluationId,
          record.final_score,
          input.proposedScore,
          input.reason,
          input.evidenceReference,
          input.policyBasis,
          p.userId,
        ],
      );
      await client.query(
        "UPDATE evaluations SET final_score=$3 WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, evaluationId, input.proposedScore],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvaluationCalibrated",
        "evaluation",
        evaluationId,
        { previous: record.final_score, proposed: input.proposedScore },
        input.reason,
      );
      return mustExist(row.rows[0]);
    });
  }

  async publish(p: Principal, evaluationId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    return this.db.tenant(p.tenantId, async (client) => {
      const existing = await client.query<{
        employee_id: string;
        cycle_id: string;
        submitted_by: string;
        template_id: string;
        purpose: string;
      }>(
        "SELECT e.employee_id,e.cycle_id,e.submitted_by,e.template_id,c.purpose FROM evaluations e JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.status='SUBMITTED' FOR UPDATE OF e",
        [p.tenantId, evaluationId],
      );
      const record = mustExist(existing.rows[0]);
      if (record.submitted_by === p.userId || record.employee_id === p.userId)
        throw new ForbiddenException(
          "Publication requires a separate approver",
        );
      await assertNoOpenReviewConflicts(client, p.tenantId, evaluationId);
      await assertReviewConflictClear(
        client,
        p.tenantId,
        evaluationId,
        "PUBLICATION",
        p.userId,
      );
      const replacementCalibration = await client.query<{
        replacement_actor_id: string;
        resolved_at: Date | string;
      }>(
        "SELECT replacement_actor_id,resolved_at FROM review_conflicts WHERE tenant_id=$1 AND evaluation_id=$2 AND stage='CALIBRATION' AND status='RESOLVED' ORDER BY resolved_at DESC LIMIT 1",
        [p.tenantId, evaluationId],
      );
      const replacement = replacementCalibration.rows[0];
      if (replacement) {
        const accepted = await client.query(
          "SELECT 1 FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=$2 AND actor_id=$3 AND created_at>=$4 LIMIT 1",
          [
            p.tenantId,
            evaluationId,
            replacement.replacement_actor_id,
            replacement.resolved_at,
          ],
        );
        if (!accepted.rows[0])
          throw new BadRequestException(
            "Approved replacement must recalibrate after conflict resolution",
          );
      }
      const calibrated = await client.query(
        "SELECT 1 FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=$2 AND actor_id<>$3 LIMIT 1",
        [p.tenantId, evaluationId, record.submitted_by],
      );
      if (!calibrated.rowCount)
        throw new BadRequestException("Independent calibration is required");
      const latestCalibration = await client.query<{ actor_id: string }>(
        "SELECT actor_id FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [p.tenantId, evaluationId],
      );
      if (latestCalibration.rows[0]?.actor_id === p.userId)
        throw new ForbiddenException(
          "Publisher must be separate from the latest calibrator",
        );
      let validationDossierId: string | null = null;
      if (record.purpose === "ADMINISTRATIVE") {
        const dossier = await client.query<{ id: string }>(
          "SELECT id FROM validation_dossiers WHERE tenant_id=$1 AND template_id=$2 AND state='REVIEWED' AND revalidate_on>=CURRENT_DATE LIMIT 1",
          [p.tenantId, record.template_id],
        );
        validationDossierId = dossier.rows[0]?.id ?? null;
        if (!validationDossierId)
          throw new BadRequestException(
            "Administrative publication requires a current independently reviewed model evidence dossier",
          );
        await client.query(
          "SELECT id FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [p.tenantId, record.employee_id],
        );
        const governanceHold = await client.query(
          "SELECT 1 FROM governance_cases WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('TRIAGED','CONFIRMED') LIMIT 1",
          [p.tenantId, record.employee_id],
        );
        if (governanceHold.rows[0])
          throw new BadRequestException(
            "Administrative publication is held by an open safety or compliance case",
          );
        const pendingContext = await client.query(
          "SELECT 1 FROM context_records WHERE tenant_id=$1 AND employee_id=$2 AND cycle_id=$3 AND status='SUBMITTED' LIMIT 1",
          [p.tenantId, record.employee_id, record.cycle_id],
        );
        if (pendingContext.rows[0])
          throw new BadRequestException(
            "Administrative publication is held until submitted context is reviewed",
          );
      }
      const row = await client.query(
        "UPDATE evaluations SET status='PUBLISHED',published_at=now(),published_by=$3,validation_dossier_id=$4 WHERE tenant_id=$1 AND id=$2 AND status='SUBMITTED' RETURNING id,status,score,final_score,published_at,validation_dossier_id",
        [p.tenantId, evaluationId, p.userId, validationDossierId],
      );
      const published = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvaluationPublished",
        "evaluation",
        evaluationId,
        { purpose: record.purpose, validationDossierId },
      );
      return published;
    });
  }

  async acknowledge(p: Principal, evaluationId: string): Promise<unknown> {
    requireRole(
      p,
      "EMPLOYEE",
      "MANAGER",
      "HR_ADMIN",
      "CALIBRATOR",
      "AUDITOR",
      "TENANT_ADMIN",
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE evaluations SET status='ACKNOWLEDGED' WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND status='PUBLISHED' RETURNING id,status",
        [p.tenantId, evaluationId, p.employeeId],
      );
      const updated = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "EvaluationAcknowledged",
        "evaluation",
        evaluationId,
      );
      return updated;
    });
  }

  async appeal(
    p: Principal,
    evaluationId: string,
    body: unknown,
  ): Promise<unknown> {
    const input = parse(appealInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const record = await client.query(
        "SELECT id FROM evaluations WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND status IN ('PUBLISHED','ACKNOWLEDGED') FOR UPDATE",
        [p.tenantId, evaluationId, p.employeeId],
      );
      mustExist(record.rows[0]);
      const row = await client.query(
        "INSERT INTO appeals(tenant_id,evaluation_id,employee_id,reason,statement) VALUES ($1,$2,$3,$4,$5) RETURNING id,state,reason,statement",
        [p.tenantId, evaluationId, p.employeeId, input.reason, input.statement],
      );
      await client.query(
        "UPDATE evaluations SET status='APPEALED' WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, evaluationId],
      );
      const created = mustExist(row.rows[0]);
      await audit(
        client,
        p.tenantId,
        p.userId,
        "AppealOpened",
        "appeal",
        created.id,
      );
      return created;
    });
  }

  async resolveAppeal(
    p: Principal,
    appealId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(
      z
        .object({
          outcome: z.enum(["UPHELD", "PARTIALLY_UPHELD", "DENIED"]),
          resolution: z.string().trim().min(10).max(5000),
          remedy: z.string().trim().min(10).max(3000),
          correctedScore: z
            .string()
            .regex(/^\d+(?:\.\d{1,4})?$/)
            .optional(),
        })
        .superRefine((value, context) => {
          if (value.outcome === "DENIED" && value.correctedScore)
            context.addIssue({
              code: "custom",
              path: ["correctedScore"],
              message: "A denied appeal cannot amend a score",
            });
        }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const current = await client.query<{
        employee_id: string;
        evaluation_id: string;
        submitted_by: string | null;
        published_by: string | null;
        final_score: string | null;
      }>(
        "SELECT a.employee_id,a.evaluation_id,e.submitted_by,e.published_by,e.final_score::text FROM appeals a JOIN evaluations e ON e.tenant_id=a.tenant_id AND e.id=a.evaluation_id WHERE a.tenant_id=$1 AND a.id=$2 AND a.state='OPEN' FOR UPDATE OF a,e",
        [p.tenantId, appealId],
      );
      const record = mustExist(current.rows[0]);
      const calibration = await client.query<{ actor_id: string }>(
        "SELECT actor_id FROM calibration_decisions WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [p.tenantId, record.evaluation_id],
      );
      if (
        [
          record.employee_id,
          record.submitted_by,
          record.published_by,
          calibration.rows[0]?.actor_id,
        ].includes(p.userId)
      )
        throw new ForbiddenException(
          "Appeal resolution requires an independent reviewer",
        );
      if (input.correctedScore && new Decimal(input.correctedScore).gt(120))
        throw new BadRequestException(
          "Corrected score exceeds the review range",
        );
      const row = await client.query(
        "UPDATE appeals SET state='RESOLVED',outcome=$3,resolution=$4,remedy=$5,resolved_by=$6,resolved_at=now(),notice_status='PENDING' WHERE tenant_id=$1 AND id=$2 AND state='OPEN' RETURNING id,evaluation_id,state,outcome,resolution,remedy,notice_status",
        [
          p.tenantId,
          appealId,
          input.outcome,
          input.resolution,
          input.remedy,
          p.userId,
        ],
      );
      const resolved = mustExist(row.rows[0]);
      if (input.correctedScore) {
        const latest = await client.query<{ amended_score: string }>(
          "SELECT amended_score::text FROM evaluation_amendments WHERE tenant_id=$1 AND evaluation_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [p.tenantId, record.evaluation_id],
        );
        const priorScore = latest.rows[0]?.amended_score ?? record.final_score;
        if (!priorScore)
          throw new BadRequestException(
            "Appealed evaluation has no prior score",
          );
        await client.query(
          "INSERT INTO evaluation_amendments(tenant_id,evaluation_id,appeal_id,previous_effective_score,amended_score,reason,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [
            p.tenantId,
            record.evaluation_id,
            appealId,
            priorScore,
            input.correctedScore,
            input.remedy,
            p.userId,
          ],
        );
      }
      await client.query(
        "INSERT INTO outbox(tenant_id,kind,payload) VALUES ($1,'AppealResolutionNotice',$2)",
        [
          p.tenantId,
          JSON.stringify({ appealId, employeeId: record.employee_id }),
        ],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "AppealResolved",
        "appeal",
        appealId,
        {
          outcome: input.outcome,
          correctedScore: input.correctedScore ?? null,
        },
        input.resolution,
      );
      return resolved;
    });
  }

  async report(
    p: Principal,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{
    rows: {
      id: string;
      employee_name: string;
      cycle_name: string;
      status: string;
      score: string | null;
      final_score: string | null;
      effective_score: string | null;
      cycle_ends_on: string;
    }[];
    count: number;
    nextCursor: string | null;
    scoreMeaning: string;
  }> {
    requireRole(
      p,
      "TENANT_ADMIN",
      "HR_ADMIN",
      "MANAGER",
      "CALIBRATOR",
      "AUDITOR",
    );
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new BadRequestException("Report limit must be between 1 and 200");
    const cursor = reportCursor(options.cursor);
    const started = performance.now();
    return this.db.tenant(p.tenantId, async (client) => {
      const rows = await client.query<{
        id: string;
        employee_name: string;
        cycle_name: string;
        status: string;
        score: string | null;
        final_score: string | null;
        effective_score: string | null;
        cycle_ends_on: string;
      }>(
        "SELECT e.id,e.employee_id,coalesce(e.person_snapshot->>'name',u.name) AS employee_name,coalesce(e.person_snapshot->>'jobId',u.job_id::text) AS job_id,(e.person_snapshot IS NOT NULL) AS historical_person_frozen,c.name AS cycle_name,c.purpose,c.ends_on::text AS cycle_ends_on,e.status,e.score::text,e.final_score::text,coalesce(a.amended_score,e.final_score)::text AS effective_score,e.published_at FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id LEFT JOIN LATERAL (SELECT amended_score FROM evaluation_amendments WHERE tenant_id=e.tenant_id AND evaluation_id=e.id ORDER BY created_at DESC,id DESC LIMIT 1) a ON true WHERE e.tenant_id=$1 AND ($2::text<>'MANAGER' OR u.manager_id=$3 OR (e.employee_id=$3 AND e.status IN ('PUBLISHED','ACKNOWLEDGED','APPEALED'))) AND ($4::date IS NULL OR (c.ends_on,e.id)<($4::date,$5::uuid)) ORDER BY c.ends_on DESC,e.id DESC LIMIT $6",
        [
          p.tenantId,
          p.role,
          p.employeeId,
          cursor?.day ?? null,
          cursor?.id ?? null,
          limit + 1,
        ],
      );
      const hasMore = rows.rows.length > limit;
      const page = rows.rows.slice(0, limit);
      const last = page.at(-1);
      logTimedOperation("evaluation_report", started, "OK", page.length);
      return {
        rows: page,
        count: page.length,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({ day: last.cycle_ends_on, id: last.id }),
              ).toString("base64url")
            : null,
        scoreMeaning:
          "Configured role-specific policy; scores across unrelated jobs are not comparable.",
      };
    });
  }

  async auditIntegrity(p: Principal): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "AUDITOR");
    return this.db.tenant(p.tenantId, (client) =>
      verifyAuditChain(client, p.tenantId),
    );
  }

  async *exportReportChunks(p: Principal): AsyncGenerator<string> {
    requireRole(
      p,
      "TENANT_ADMIN",
      "HR_ADMIN",
      "MANAGER",
      "CALIBRATOR",
      "AUDITOR",
    );
    const cells = (values: (string | null)[]) =>
      values
        .map((value) => {
          const safe = /^[=+\-@\t\r]/.test(value ?? "")
            ? `'${value}`
            : (value ?? "");
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(",");
    let rowCount = 0;
    let complete = false;
    try {
      yield "employee,cycle,status,calculated_score,published_score,effective_score\r\n";
      let cursor: string | undefined;
      do {
        const page = await this.report(p, {
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        rowCount += page.rows.length;
        if (page.rows.length)
          yield page.rows
            .map((row) =>
              cells([
                row.employee_name,
                row.cycle_name,
                row.status,
                row.score,
                row.final_score,
                row.effective_score,
              ]),
            )
            .join("\r\n") + "\r\n";
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      complete = true;
    } finally {
      await this.db.tenant(p.tenantId, (client) =>
        audit(
          client,
          p.tenantId,
          p.userId,
          "ReportExported",
          "export",
          randomUUID(),
          {
            rowCount,
            format: "CSV",
            complete,
          },
        ),
      );
    }
  }

  async exportReport(p: Principal): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.exportReportChunks(p)) chunks.push(chunk);
    return chunks.join("");
  }
}
