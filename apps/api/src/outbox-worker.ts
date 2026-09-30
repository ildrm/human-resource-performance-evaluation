import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";

type Job = {
  id: string;
  kind: string;
  payload: unknown;
};

export class OutboxWorker {
  constructor(private readonly pool: Pool) {}

  private async tenantTransaction<T>(
    tenantId: string,
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        tenantId,
      ]);
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async claim(tenantId: string, workerId: string): Promise<Job | null> {
    return this.tenantTransaction(tenantId, async (client) => {
      const result = await client.query<Job>(
        `WITH picked AS (
           SELECT id FROM outbox
           WHERE tenant_id=$1 AND delivered_at IS NULL AND dead_lettered_at IS NULL
             AND available_at<=now() AND (locked_until IS NULL OR locked_until<now())
           ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE outbox o SET locked_by=$2,locked_until=now()+interval '60 seconds',attempts=attempts+1
         FROM picked WHERE o.tenant_id=$1 AND o.id=picked.id
         RETURNING o.id,o.kind,o.payload`,
        [tenantId, workerId],
      );
      return result.rows[0] ?? null;
    });
  }

  private async deliver(
    tenantId: string,
    workerId: string,
    job: Job,
  ): Promise<void> {
    await this.tenantTransaction(tenantId, async (client) => {
      const lock = await client.query(
        "SELECT 1 FROM outbox WHERE tenant_id=$1 AND id=$2 AND locked_by=$3 AND delivered_at IS NULL AND locked_until>now() FOR UPDATE",
        [tenantId, job.id, workerId],
      );
      if (!lock.rowCount) return;
      let state: "DELIVERED" | "NO_SUBSCRIBERS" = "NO_SUBSCRIBERS";
      if (job.kind === "AppealResolutionNotice") {
        const payload = job.payload as {
          appealId?: unknown;
          employeeId?: unknown;
        };
        if (
          typeof payload?.appealId !== "string" ||
          typeof payload?.employeeId !== "string"
        )
          throw new Error("Invalid appeal notice payload");
        const appeal = await client.query<{ employee_id: string }>(
          "SELECT employee_id FROM appeals WHERE tenant_id=$1 AND id=$2 AND employee_id=$3 AND state='RESOLVED'",
          [tenantId, payload.appealId, payload.employeeId],
        );
        if (!appeal.rows[0])
          throw new Error("Appeal notice has no resolved recipient");
        await client.query(
          "INSERT INTO notifications(tenant_id,recipient_id,event_id,kind,resource_id) VALUES ($1,$2,$3,'APPEAL_RESOLVED',$4) ON CONFLICT (tenant_id,event_id,recipient_id) DO NOTHING",
          [tenantId, appeal.rows[0].employee_id, job.id, payload.appealId],
        );
        await client.query(
          "UPDATE appeals SET notice_status='DELIVERED' WHERE tenant_id=$1 AND id=$2 AND notice_status='PENDING'",
          [tenantId, payload.appealId],
        );
        state = "DELIVERED";
      }
      await client.query(
        "UPDATE outbox SET delivery_state=$4,delivered_at=now(),locked_by=NULL,locked_until=NULL WHERE tenant_id=$1 AND id=$2 AND locked_by=$3",
        [tenantId, job.id, workerId, state],
      );
    });
  }

  private async fail(
    tenantId: string,
    workerId: string,
    jobId: string,
    error: unknown,
  ): Promise<void> {
    await this.tenantTransaction(tenantId, async (client) => {
      await client.query(
        `UPDATE outbox SET locked_by=NULL,locked_until=NULL,
           last_error=$4,available_at=now()+make_interval(secs=>least(3600,power(2,least(attempts,11))::integer)),
           dead_lettered_at=CASE WHEN attempts>=10 THEN now() ELSE NULL END,
           delivery_state=CASE WHEN attempts>=10 THEN 'DEAD_LETTER' ELSE 'PENDING' END
         WHERE tenant_id=$1 AND id=$2 AND locked_by=$3`,
        [
          tenantId,
          jobId,
          workerId,
          error instanceof Error
            ? error.message.slice(0, 300)
            : "Delivery failed",
        ],
      );
    });
  }

  async tick(): Promise<number> {
    const tenants = await this.pool.query<{ id: string }>(
      "SELECT id FROM tenants ORDER BY id",
    );
    const workerId = randomUUID();
    let processed = 0;
    for (const tenant of tenants.rows) {
      for (let index = 0; index < 20; index += 1) {
        const job = await this.claim(tenant.id, workerId);
        if (!job) break;
        try {
          await this.deliver(tenant.id, workerId, job);
        } catch (error) {
          await this.fail(tenant.id, workerId, job.id, error);
        }
        processed += 1;
      }
    }
    return processed;
  }
}

if (process.env.HPI_WORKER_MAIN === "1") {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    statement_timeout: 15000,
  });
  const worker = new OutboxWorker(pool);
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  try {
    while (!stopping) {
      try {
        await worker.tick();
      } catch (error) {
        process.stderr.write(
          `Worker tick failed: ${error instanceof Error ? error.message : "unknown"}\n`,
        );
      }
      if (!stopping) await delay(1000);
    }
  } finally {
    await pool.end();
  }
}
