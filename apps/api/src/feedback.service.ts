import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  behaviorScaleInput,
  feedbackCampaignInput,
  feedbackRatingInput,
} from "@hpi/contracts";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { audit } from "./audit.js";
import { Database } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

const anonymousRelationships = new Set([
  "PEER",
  "DIRECT_REPORT",
  "PROJECT_LEADER",
  "MATRIX_MANAGER",
  "INTERNAL_CUSTOMER",
  "EXTERNAL_STAKEHOLDER",
]);

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((issue) => issue.message),
    );
  return result.data;
}

function unique(items: string[]): boolean {
  return new Set(items).size === items.length;
}

@Injectable()
export class FeedbackService {
  constructor(private readonly db: Database) {}

  async createScale(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(behaviorScaleInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const job = await client.query(
        "SELECT id FROM jobs WHERE tenant_id=$1 AND id=$2 AND approved=true",
        [p.tenantId, input.jobId],
      );
      if (!job.rowCount)
        throw new BadRequestException("An approved job model is required");
      const row = await client.query(
        "INSERT INTO behavior_scales(tenant_id,job_id,name,version,job_analysis_reference,development_method,limitations,anchors,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,state,version",
        [
          p.tenantId,
          input.jobId,
          input.name,
          input.version,
          input.jobAnalysisReference,
          input.developmentMethod,
          input.limitations,
          JSON.stringify(input.anchors),
          p.userId,
        ],
      );
      const scale = row.rows[0]!;
      await audit(
        client,
        p.tenantId,
        p.userId,
        "BehaviorScaleCreated",
        "behavior_scale",
        scale.id as string,
      );
      return scale;
    });
  }

  async activateScale(
    p: Principal,
    scaleId: string,
    body: unknown,
  ): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(
      z.object({ approvalReference: z.string().trim().min(10).max(1000) }),
      body,
    );
    return this.db.tenant(p.tenantId, async (client) => {
      const existing = await client.query<{ created_by: string }>(
        "SELECT created_by FROM behavior_scales WHERE tenant_id=$1 AND id=$2 AND state='DRAFT' FOR UPDATE",
        [p.tenantId, scaleId],
      );
      if (!existing.rows[0])
        throw new NotFoundException("Draft scale not found");
      if (existing.rows[0].created_by === p.userId)
        throw new ForbiddenException(
          "Scale approval requires another reviewer",
        );
      const row = await client.query(
        "UPDATE behavior_scales SET state='ACTIVE',approved_by=$3,approval_reference=$4,approved_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,state,version",
        [p.tenantId, scaleId, p.userId, input.approvalReference],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "BehaviorScaleActivated",
        "behavior_scale",
        scaleId,
        {},
        input.approvalReference,
      );
      return row.rows[0];
    });
  }

  async createCampaign(p: Principal, body: unknown): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    const input = parse(feedbackCampaignInput, body);
    const weighted = input.weights.map((item) => item.relationship);
    const invited = input.invitations.map((item) => item.respondentId);
    if (!unique(weighted) || !unique(invited))
      throw new BadRequestException("Duplicate relationship or respondent");
    if (
      !input.weights
        .reduce((sum, item) => sum.plus(item.weight), new Decimal(0))
        .eq(1) ||
      input.weights.some((item) => new Decimal(item.weight).lte(0))
    )
      throw new BadRequestException(
        "Positive relationship weights must sum to 1",
      );
    for (const invitation of input.invitations) {
      if (
        (invitation.respondentId === input.employeeId) !==
        (invitation.relationship === "SELF")
      )
        throw new BadRequestException(
          "Self assessment must use the subject's own account",
        );
      if (
        invitation.relationship !== "SELF" &&
        !weighted.includes(invitation.relationship)
      )
        throw new BadRequestException(
          "Each invited relationship needs a weight",
        );
    }
    for (const item of input.weights) {
      const count = input.invitations.filter(
        (invitation) => invitation.relationship === item.relationship,
      ).length;
      const minimum = anonymousRelationships.has(item.relationship)
        ? input.minimumRespondents
        : 1;
      if (count < minimum)
        throw new BadRequestException(
          "Not enough invited respondents for a weighted group",
        );
    }
    return this.db.tenant(p.tenantId, async (client) => {
      const subject = await client.query<{
        job_id: string | null;
        purpose: string;
        scale_job_id: string;
        scale_state: string;
      }>(
        "SELECT u.job_id,c.purpose,s.job_id AS scale_job_id,s.state AS scale_state FROM users u JOIN cycles c ON c.tenant_id=u.tenant_id AND c.id=$3 JOIN behavior_scales s ON s.tenant_id=u.tenant_id AND s.id=$4 WHERE u.tenant_id=$1 AND u.id=$2 AND u.active=true",
        [p.tenantId, input.employeeId, input.cycleId, input.scaleId],
      );
      const record = subject.rows[0];
      if (!record)
        throw new NotFoundException("Subject, cycle, or scale not found");
      if (
        record.job_id !== record.scale_job_id ||
        record.scale_state !== "ACTIVE"
      )
        throw new BadRequestException(
          "Active scale must match the employee's job",
        );
      const people = await client.query(
        "SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND active=true",
        [p.tenantId, invited],
      );
      if (people.rowCount !== invited.length)
        throw new BadRequestException(
          "All respondents must be active tenant users",
        );
      const campaign = await client.query<{ id: string; state: string }>(
        "INSERT INTO feedback_campaigns(tenant_id,employee_id,cycle_id,scale_id,purpose,relationship_weights,minimum_respondents,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,state",
        [
          p.tenantId,
          input.employeeId,
          input.cycleId,
          input.scaleId,
          record.purpose,
          JSON.stringify(input.weights),
          input.minimumRespondents,
          p.userId,
        ],
      );
      const created = campaign.rows[0]!;
      for (const invitation of input.invitations) {
        await client.query(
          "INSERT INTO feedback_invitations(tenant_id,campaign_id,respondent_id,relationship) VALUES ($1,$2,$3,$4)",
          [
            p.tenantId,
            created.id,
            invitation.respondentId,
            invitation.relationship,
          ],
        );
      }
      await audit(
        client,
        p.tenantId,
        p.userId,
        "FeedbackCampaignCreated",
        "feedback_campaign",
        created.id,
        { purpose: record.purpose, invited: invited.length },
      );
      return created;
    });
  }

  async assignments(p: Principal): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const rows = await client.query(
        "SELECT c.id AS campaign_id,u.name AS subject_name,s.name AS scale_name,s.anchors,c.purpose,i.relationship FROM feedback_invitations i JOIN feedback_campaigns c ON c.tenant_id=i.tenant_id AND c.id=i.campaign_id JOIN behavior_scales s ON s.tenant_id=c.tenant_id AND s.id=c.scale_id JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.employee_id LEFT JOIN feedback_ratings r ON r.tenant_id=i.tenant_id AND r.campaign_id=i.campaign_id AND r.respondent_id=i.respondent_id WHERE i.tenant_id=$1 AND i.respondent_id=$2 AND c.state='OPEN' AND r.respondent_id IS NULL ORDER BY c.created_at LIMIT 100",
        [p.tenantId, p.userId],
      );
      return { assignments: rows.rows };
    });
  }

  async catalog(p: Principal): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const scales = await client.query(
        "SELECT id,job_id,name,version,state FROM behavior_scales WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200",
        [p.tenantId],
      );
      const campaigns = await client.query(
        "SELECT c.id,c.employee_id,u.name AS employee_name,c.cycle_id,c.scale_id,c.purpose,c.state FROM feedback_campaigns c JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.employee_id WHERE c.tenant_id=$1 AND ($2::text IN ('TENANT_ADMIN','HR_ADMIN','CALIBRATOR','AUDITOR') OR c.employee_id=$3 OR ($2::text='MANAGER' AND u.manager_id=$3)) ORDER BY c.created_at DESC LIMIT 200",
        [p.tenantId, p.role, p.userId],
      );
      return {
        scales: ["TENANT_ADMIN", "HR_ADMIN"].includes(p.role)
          ? scales.rows
          : [],
        campaigns: campaigns.rows,
      };
    });
  }

  async rate(
    p: Principal,
    campaignId: string,
    body: unknown,
  ): Promise<unknown> {
    const input = parse(feedbackRatingInput, body);
    return this.db.tenant(p.tenantId, async (client) => {
      const campaign = await client.query<{ state: string }>(
        "SELECT c.state FROM feedback_campaigns c JOIN feedback_invitations i ON i.tenant_id=c.tenant_id AND i.campaign_id=c.id WHERE c.tenant_id=$1 AND c.id=$2 AND i.respondent_id=$3 FOR UPDATE OF c",
        [p.tenantId, campaignId, p.userId],
      );
      if (!campaign.rows[0])
        throw new NotFoundException("Assignment not found");
      if (campaign.rows[0].state !== "OPEN")
        throw new BadRequestException("Feedback campaign is closed");
      const inserted = await client.query(
        "INSERT INTO feedback_ratings(tenant_id,campaign_id,respondent_id,level,observed_example) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING respondent_id",
        [p.tenantId, campaignId, p.userId, input.level, input.observedExample],
      );
      if (!inserted.rowCount)
        throw new BadRequestException("Feedback has already been submitted");
      await audit(
        client,
        p.tenantId,
        p.userId,
        "FeedbackSubmitted",
        "feedback_campaign",
        campaignId,
      );
      return { accepted: true };
    });
  }

  async closeCampaign(p: Principal, campaignId: string): Promise<unknown> {
    requireRole(p, "TENANT_ADMIN", "HR_ADMIN");
    return this.db.tenant(p.tenantId, async (client) => {
      const existing = await client.query<{ created_by: string }>(
        "SELECT created_by FROM feedback_campaigns WHERE tenant_id=$1 AND id=$2 AND state='OPEN' FOR UPDATE",
        [p.tenantId, campaignId],
      );
      if (!existing.rows[0])
        throw new NotFoundException("Open campaign not found");
      if (existing.rows[0].created_by === p.userId)
        throw new ForbiddenException(
          "Campaign closure requires another reviewer",
        );
      const row = await client.query(
        "UPDATE feedback_campaigns SET state='CLOSED',closed_by=$3,closed_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,state",
        [p.tenantId, campaignId, p.userId],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "FeedbackCampaignClosed",
        "feedback_campaign",
        campaignId,
      );
      return row.rows[0];
    });
  }

  async summary(p: Principal, campaignId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const campaign = await client.query<{
        employee_id: string;
        manager_id: string | null;
        state: string;
        purpose: string;
        minimum_respondents: number;
        relationship_weights: { relationship: string; weight: string }[];
        scale_name: string;
        anchors: { level: number; behavior: string }[];
      }>(
        "SELECT c.employee_id,u.manager_id,c.state,c.purpose,c.minimum_respondents,c.relationship_weights,s.name AS scale_name,s.anchors FROM feedback_campaigns c JOIN users u ON u.tenant_id=c.tenant_id AND u.id=c.employee_id JOIN behavior_scales s ON s.tenant_id=c.tenant_id AND s.id=c.scale_id WHERE c.tenant_id=$1 AND c.id=$2",
        [p.tenantId, campaignId],
      );
      const record = campaign.rows[0];
      if (!record) throw new NotFoundException("Campaign not found");
      if (!canSeeEmployee(p, record.employee_id, record.manager_id))
        throw new ForbiddenException();
      if (record.state !== "CLOSED")
        return { status: "NOT_RELEASED", purpose: record.purpose };
      const ratings = await client.query<{
        relationship: string;
        level: number;
      }>(
        "SELECT i.relationship,r.level FROM feedback_ratings r JOIN feedback_invitations i ON i.tenant_id=r.tenant_id AND i.campaign_id=r.campaign_id AND i.respondent_id=r.respondent_id WHERE r.tenant_id=$1 AND r.campaign_id=$2",
        [p.tenantId, campaignId],
      );
      const groups = new Map<string, Decimal[]>();
      for (const rating of ratings.rows) {
        const scores = groups.get(rating.relationship) ?? [];
        scores.push(new Decimal(rating.level));
        groups.set(rating.relationship, scores);
      }
      const self = groups.get("SELF")?.[0];
      const selfScore =
        p.userId === record.employee_id && self ? self.toFixed(2) : null;
      let weightedScore = new Decimal(0);
      for (const item of record.relationship_weights) {
        const scores = groups.get(item.relationship) ?? [];
        const required = anonymousRelationships.has(item.relationship)
          ? record.minimum_respondents
          : 1;
        if (scores.length < required)
          return {
            status: "SUPPRESSED",
            purpose: record.purpose,
            scaleName: record.scale_name,
            selfScore,
            reason:
              "A weighted respondent group is below its release threshold",
          };
        const mean = scores
          .reduce((sum, score) => sum.plus(score), new Decimal(0))
          .div(scores.length);
        weightedScore = weightedScore.plus(mean.times(item.weight));
      }
      return {
        status: "RELEASED",
        purpose: record.purpose,
        scaleName: record.scale_name,
        anchors: record.anchors,
        weightedScore: weightedScore.toDecimalPlaces(2).toFixed(2),
        selfScore,
        interpretation:
          "Role-specific descriptive feedback. This is not an automatically calculated performance score or a validated psychometric estimate.",
      };
    });
  }
}
