import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { reviewMessageInput } from "@hpi/contracts";
import { audit } from "./audit.js";
import { Database, type SqlClient } from "./db.js";
import { canSeeEmployee, type Principal } from "./security.js";

type ReviewAccess = {
  employee_id: string;
  manager_id: string | null;
  status: string;
};
const visibleStates = ["PUBLISHED", "ACKNOWLEDGED", "APPEALED"];

@Injectable()
export class DiscussionService {
  constructor(private readonly db: Database) {}

  private async evaluation(
    client: SqlClient,
    p: Principal,
    evaluationId: string,
    lock: boolean,
  ): Promise<ReviewAccess> {
    const result = await client.query<ReviewAccess>(
      `SELECT e.employee_id,u.manager_id,e.status FROM evaluations e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.employee_id WHERE e.tenant_id=$1 AND e.id=$2${lock ? " FOR UPDATE OF e" : ""}`,
      [p.tenantId, evaluationId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException("Evaluation not found");
    if (!canSeeEmployee(p, row.employee_id, row.manager_id))
      throw new ForbiddenException("Evaluation outside access scope");
    if (p.userId === row.employee_id && !visibleStates.includes(row.status))
      throw new ForbiddenException("Review discussion is not yet published");
    return row;
  }

  async list(p: Principal, evaluationId: string): Promise<unknown> {
    return this.db.tenant(p.tenantId, async (client) => {
      const evaluation = await this.evaluation(client, p, evaluationId, false);
      const employee = p.userId === evaluation.employee_id;
      const result = await client.query(
        `SELECT m.id,m.channel,m.topic,m.body,m.author_id,u.name AS author_name,m.created_at
         FROM review_messages m JOIN users u ON u.tenant_id=m.tenant_id AND u.id=m.author_id
         WHERE m.tenant_id=$1 AND m.evaluation_id=$2${employee ? " AND m.channel='SHARED'" : ""}
         ORDER BY m.created_at,m.id LIMIT 501`,
        [p.tenantId, evaluationId],
      );
      if (result.rows.length > 500)
        throw new BadRequestException(
          "Discussion exceeds the 500-message read limit; request an assisted export",
        );
      return { messages: result.rows };
    });
  }

  async post(
    p: Principal,
    evaluationId: string,
    body: unknown,
  ): Promise<unknown> {
    const parsed = reviewMessageInput.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((item) => item.message),
      );
    const input = parsed.data;
    return this.db.tenant(p.tenantId, async (client) => {
      const evaluation = await this.evaluation(client, p, evaluationId, true);
      const employee = p.userId === evaluation.employee_id;
      if (p.role === "AUDITOR")
        throw new ForbiddenException("Auditor has read-only discussion access");
      if (input.channel === "INTERNAL") {
        if (employee)
          throw new ForbiddenException(
            "Employee cannot post to internal discussion",
          );
        if (
          evaluation.status === "INCOMPLETE" ||
          evaluation.status === "CALCULATED"
        )
          throw new BadRequestException(
            "Internal discussion begins after review submission",
          );
        if (input.topic === "APPEAL" && evaluation.status !== "APPEALED")
          throw new BadRequestException("Appeal discussion requires an appeal");
      } else {
        if (!visibleStates.includes(evaluation.status))
          throw new BadRequestException(
            "Shared discussion begins after publication",
          );
        if (input.topic === "CALIBRATION")
          throw new BadRequestException("Calibration discussion is internal");
        if (input.topic === "APPEAL" && evaluation.status !== "APPEALED")
          throw new BadRequestException("Appeal discussion requires an appeal");
        if (
          !["TENANT_ADMIN", "HR_ADMIN", "MANAGER", "EMPLOYEE"].includes(p.role)
        )
          throw new ForbiddenException(
            "Actor cannot post a shared discussion message",
          );
      }
      const created = await client.query(
        "INSERT INTO review_messages(tenant_id,evaluation_id,author_id,channel,topic,body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,evaluation_id,author_id,channel,topic,body,created_at",
        [
          p.tenantId,
          evaluationId,
          p.userId,
          input.channel,
          input.topic,
          input.body,
        ],
      );
      await audit(
        client,
        p.tenantId,
        p.userId,
        "ReviewMessagePosted",
        "review_message",
        created.rows[0].id,
        { evaluationId, channel: input.channel, topic: input.topic },
      );
      return created.rows[0];
    });
  }
}
