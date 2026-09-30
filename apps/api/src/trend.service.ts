import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { describeTrend, type TrendPoint } from "@hpi/calculation-engine";
import { Database } from "./db.js";
import { canSeeEmployee, requireRole, type Principal } from "./security.js";

type EvaluationPoint = {
  id: string;
  template_id: string;
  template_name: string;
  template_version: number;
  job_id: string;
  purpose: string;
  starts_on: string | Date;
  ends_on: string | Date;
  score: string;
  final_score: string | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

@Injectable()
export class TrendService {
  constructor(private readonly db: Database) {}

  async forEmployee(p: Principal, employeeId: string): Promise<unknown> {
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
      const result = await client.query<EvaluationPoint>(
        "SELECT e.id,e.template_id,t.name AS template_name,t.version AS template_version,t.job_id,c.purpose,c.starts_on,c.ends_on,e.score::text,e.final_score::text FROM evaluations e JOIN templates t ON t.tenant_id=e.tenant_id AND t.id=e.template_id JOIN cycles c ON c.tenant_id=e.tenant_id AND c.id=e.cycle_id WHERE e.tenant_id=$1 AND e.employee_id=$2 AND e.status IN ('PUBLISHED','ACKNOWLEDGED','APPEALED') AND e.score IS NOT NULL ORDER BY c.ends_on,e.id LIMIT 501",
        [p.tenantId, employeeId],
      );
      if (result.rows.length > 500)
        throw new PayloadTooLargeException(
          "Trend history exceeds 500 evaluations; request an assisted analysis",
        );
      const groups = new Map<string, EvaluationPoint[]>();
      for (const row of result.rows) {
        const key = `${row.template_id}:${row.purpose}`;
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
      }
      return {
        employeeId,
        meaning:
          "Descriptive change in saved calculated scores only. Groups use one template and one review purpose; no cross-job ranking, causal claim, or forecast.",
        series: [...groups.values()].map((group) => {
          const first = group[0]!;
          const points: TrendPoint[] = group.map((row) => ({
            evaluationId: row.id,
            startsOn: dateOnly(row.starts_on),
            endsOn: dateOnly(row.ends_on),
            score: row.score,
          }));
          return {
            templateId: first.template_id,
            templateName: first.template_name,
            templateVersion: first.template_version,
            jobId: first.job_id,
            purpose: first.purpose,
            analysis: describeTrend(points),
            finalScores: group.map((row) => ({
              evaluationId: row.id,
              finalScore: row.final_score,
            })),
          };
        }),
      };
    });
  }
}
