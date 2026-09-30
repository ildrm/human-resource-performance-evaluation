import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecutionContext } from "@nestjs/common";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  canSeeEmployee,
  newSessionToken,
  parseSessionToken,
  SessionGuard,
  type Principal,
} from "./security.js";
import type { Database, SqlClient } from "./db.js";

const employee: Principal = {
  tenantId: "tenant-a",
  userId: "alice",
  employeeId: "alice",
  role: "EMPLOYEE",
  exp: Date.now() + 10000,
};

describe("access boundaries", () => {
  it("limits an employee to their own profile and a manager to their own team", () => {
    expect(canSeeEmployee(employee, "alice", null)).toBe(true);
    expect(canSeeEmployee(employee, "bob", null)).toBe(false);
    expect(
      canSeeEmployee({ ...employee, role: "MANAGER" }, "bob", "alice"),
    ).toBe(true);
    expect(
      canSeeEmployee({ ...employee, role: "MANAGER" }, "bob", "other-manager"),
    ).toBe(false);
  });
  it("revokes an opaque session and observes changed roles", async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(await readFile(resolve("migrations/001_core.sql"), "utf8"));
      await pg.exec(
        await readFile(resolve("migrations/005_sessions.sql"), "utf8"),
      );
      const tenantId = "11111111-1111-4111-8111-111111111111";
      const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await pg.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A')", [
        tenantId,
      ]);
      await pg.query(
        "INSERT INTO users(tenant_id,id,email,name,password_hash,role) VALUES ($1,$2,'a@example.test','A','test','EMPLOYEE')",
        [tenantId, userId],
      );
      const token = newSessionToken(tenantId);
      const parsed = parseSessionToken(token)!;
      expect(parseSessionToken(`${token}altered`)).toBeNull();
      await pg.query(
        "INSERT INTO sessions(tenant_id,token_hash,user_id,expires_at) VALUES ($1,$2,$3,now() + interval '8 hours')",
        [tenantId, parsed.tokenHash, userId],
      );
      const database = {
        tenant<T>(
          tenant: string,
          fn: (client: SqlClient) => Promise<T>,
        ): Promise<T> {
          return pg.transaction(async (tx) => {
            await tx.query("SELECT set_config('app.tenant_id',$1,true)", [
              tenant,
            ]);
            return fn(tx as unknown as SqlClient);
          });
        },
      } as Database;
      const guard = new SessionGuard(database);
      const request = { headers: { cookie: `hpi_session=${token}` } } as {
        headers: { cookie: string };
        principal?: Principal;
      };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      expect(await guard.canActivate(context)).toBe(true);
      expect(request.principal?.role).toBe("EMPLOYEE");
      await pg.query(
        "UPDATE users SET role='HR_ADMIN' WHERE tenant_id=$1 AND id=$2",
        [tenantId, userId],
      );
      expect(await guard.canActivate(context)).toBe(true);
      expect(request.principal?.role).toBe("HR_ADMIN");
      await pg.query(
        "UPDATE sessions SET revoked_at=now() WHERE tenant_id=$1 AND token_hash=$2",
        [tenantId, parsed.tokenHash],
      );
      await expect(guard.canActivate(context)).rejects.toThrow(
        "Session user no longer active",
      );
    } finally {
      await pg.close();
    }
  }, 30000);
});
