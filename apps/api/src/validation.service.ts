import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { validationDossierInput, validationReviewInput } from "@hpi/contracts";
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

function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

@Injectable()
export class ValidationService {
  constructor(private readonly db: Database) {}

  async list(p: Principal): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN", "CALIBRATOR", "AUDITOR");
    return this.db.tenant(p.tenantId, async (client) => {
      const rows = await client.query(
        "SELECT d.*,t.name AS template_name,t.version AS template_version,j.name AS job_name FROM validation_dossiers d JOIN templates t ON t.tenant_id=d.tenant_id AND t.id=d.template_id JOIN jobs j ON j.tenant_id=t.tenant_id AND j.id=t.job_id WHERE d.tenant_id=$1 ORDER BY d.created_at DESC LIMIT 200",
        [p.tenantId],
      );
      return { dossiers: rows.rows };
    });
  }

  async create(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(validationDossierInput, body);
    if (input.revalidateOn < new Date().toISOString().slice(0, 10))
      throw new BadRequestException("Revalidation date must be in the future");
    return this.db.tenant(p.tenantId, async (client) => {
      const template = await client.query(
        "SELECT id FROM templates WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
        [p.tenantId, input.templateId],
      );
      if (!template.rows[0]) throw new NotFoundException("Template not found");
      const latest = await client.query<{ version: number }>(
        "SELECT version FROM validation_dossiers WHERE tenant_id=$1 AND template_id=$2 ORDER BY version DESC LIMIT 1",
        [p.tenantId, input.templateId],
      );
      const version = (latest.rows[0]?.version ?? 0) + 1;
      const row = await client.query<{ id: string }>(
        "INSERT INTO validation_dossiers(tenant_id,template_id,version,intended_interpretation,intended_population,job_analysis_reference,content_evidence_reference,reliability_evidence_or_rationale,criterion_evidence_or_rationale,construct_evidence_or_rationale,fairness_review_reference,limitations,revalidate_on,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id",
        [
          p.tenantId,
          input.templateId,
          version,
          input.intendedInterpretation,
          input.intendedPopulation,
          input.jobAnalysisReference,
          input.contentEvidenceReference,
          input.reliabilityEvidenceOrRationale,
          input.criterionEvidenceOrRationale,
          input.constructEvidenceOrRationale,
          input.fairnessReviewReference,
          input.limitations,
          input.revalidateOn,
          p.userId,
        ],
      );
      const id = row.rows[0]!.id;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ValidationDossierCreated",
        "validation_dossier",
        id,
        { templateId: input.templateId, version },
      );
      return { id, templateId: input.templateId, version, state: "DRAFT" };
    });
  }

  async review(
    p: Principal,
    dossierId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(validationReviewInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query<{
        template_id: string;
        created_by: string;
        revalidate_on: string;
      }>(
        "SELECT template_id,created_by,revalidate_on FROM validation_dossiers WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' FOR UPDATE",
        [p.tenantId, dossierId],
      );
      const draft = row.rows[0];
      if (!draft) throw new NotFoundException("Draft dossier not found");
      if (draft.created_by === p.userId)
        throw new ForbiddenException("Dossier review requires another actor");
      if (dateOnly(draft.revalidate_on) < new Date().toISOString().slice(0, 10))
        throw new BadRequestException("Dossier revalidation date has passed");
      const template = await client.query<{ state: string }>(
        "SELECT state FROM templates WHERE tenant_id=$1 AND id=$2",
        [p.tenantId, draft.template_id],
      );
      if (template.rows[0]?.state !== "ACTIVE")
        throw new BadRequestException("Template must be active before review");
      await client.query(
        "UPDATE validation_dossiers SET state='RETIRED' WHERE tenant_id=$1 AND template_id=$2 AND state='REVIEWED'",
        [p.tenantId, draft.template_id],
      );
      const reviewed = await client.query(
        "UPDATE validation_dossiers SET state='REVIEWED',reviewed_by=$3,review_note=$4,reviewed_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,state,version,revalidate_on",
        [p.tenantId, dossierId, p.userId, input.reviewNote],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ValidationDossierReviewed",
        "validation_dossier",
        dossierId,
        { templateId: draft.template_id },
        input.reviewNote,
      );
      return reviewed.rows[0];
    });
  }

  async retire(
    p: Principal,
    dossierId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(
      z.object({ reason: z.string().trim().min(20).max(3000) }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const row = await client.query(
        "UPDATE validation_dossiers SET state='RETIRED' WHERE tenant_id=$1 AND id=$2 AND state='REVIEWED' RETURNING id,state",
        [p.tenantId, dossierId],
      );
      if (!row.rows[0])
        throw new NotFoundException("Reviewed dossier not found");
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ValidationDossierRetired",
        "validation_dossier",
        dossierId,
        {},
        input.reason,
      );
      return row.rows[0];
    });
  }
}
