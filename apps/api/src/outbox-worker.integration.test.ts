import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { OutboxWorker } from "./outbox-worker.js";

describe("durable in-app appeal notice", () => {
  it("delivers once and clears the leased outbox event", async () => {
    const pg = await PGlite.create();
    try {
      const names = (await readdir(resolve("migrations")))
        .filter((name) => /^\d{3}_.*\.sql$/.test(name))
        .sort();
      for (const name of names)
        await pg.exec(await readFile(resolve("migrations", name), "utf8"));
      const tenant = "11111111-1111-4111-8111-111111111111";
      const employee = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const reviewer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const job = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const template = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      const cycle = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      const evaluation = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      const appeal = "12121212-1212-4212-8212-121212121212";
      const event = "13131313-1313-4313-8313-131313131313";
      await pg.query(
        "INSERT INTO tenants(id,slug,name) VALUES ($1,'worker','Worker')",
        [tenant],
      );
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'employee@example.test','Employee','x','EMPLOYEE'),($1,$3,'reviewer@example.test','Reviewer','x','HR_ADMIN')",
        [tenant, employee, reviewer],
      );
      await pg.query(
        "INSERT INTO jobs(tenant_id,id,name,family,purpose,version,approved) VALUES ($1,$2,'Analyst','Operations','Synthetic',1,true)",
        [tenant, job],
      );
      await pg.query(
        "INSERT INTO templates(tenant_id,id,job_id,name,version,effective_from,dimensions,state) VALUES ($1,$2,$3,'Model',1,'2026-01-01','[]','ACTIVE')",
        [tenant, template, job],
      );
      await pg.query(
        "INSERT INTO cycles(tenant_id,id,name,starts_on,ends_on,purpose) VALUES ($1,$2,'Cycle','2026-01-01','2026-01-31','DEVELOPMENT')",
        [tenant, cycle],
      );
      await pg.query(
        "INSERT INTO evaluations(tenant_id,id,employee_id,cycle_id,template_id,status,input_snapshot,result_snapshot,submitted_by,published_by) VALUES ($1,$2,$3,$4,$5,'APPEALED','{}','{}',$6,$6)",
        [tenant, evaluation, employee, cycle, template, reviewer],
      );
      await pg.query(
        "INSERT INTO appeals(tenant_id,id,evaluation_id,employee_id,reason,statement,state,resolution,notice_status) VALUES ($1,$2,$3,$4,'CONTEXT','Synthetic dispute','RESOLVED','Reviewed independently','PENDING')",
        [tenant, appeal, evaluation, employee],
      );
      await pg.query(
        "INSERT INTO outbox(tenant_id,id,kind,payload) VALUES ($1,$2,'AppealResolutionNotice',$3)",
        [
          tenant,
          event,
          JSON.stringify({ appealId: appeal, employeeId: employee }),
        ],
      );
      const client = {
        query: (sql: string, params?: unknown[]) => pg.query(sql, params),
        release: () => undefined,
      } as unknown as PoolClient;
      const pool = {
        connect: async () => client,
        query: (sql: string, params?: unknown[]) => pg.query(sql, params),
      } as unknown as Pool;
      const worker = new OutboxWorker(pool);
      expect(await worker.tick()).toBe(1);
      expect(await worker.tick()).toBe(0);
      const notices = await pg.query<{ event_id: string }>(
        "SELECT event_id FROM notifications WHERE tenant_id=$1 AND recipient_id=$2",
        [tenant, employee],
      );
      expect(notices.rows.map((row) => row.event_id)).toEqual([event]);
      const state = await pg.query<{
        delivery_state: string;
        notice_status: string;
      }>(
        "SELECT o.delivery_state,a.notice_status FROM outbox o JOIN appeals a ON a.tenant_id=o.tenant_id AND a.id=$2 WHERE o.tenant_id=$1 AND o.id=$3",
        [tenant, appeal, event],
      );
      expect(state.rows[0]).toMatchObject({
        delivery_state: "DELIVERED",
        notice_status: "DELIVERED",
      });
    } finally {
      await pg.close();
    }
  }, 30000);
});
