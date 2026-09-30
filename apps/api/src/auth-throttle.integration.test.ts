import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  clearLoginFailures,
  cleanupLoginFailures,
  loginAttemptKey,
  loginBlocked,
  recordLoginFailure,
} from "./auth-throttle.js";
import type { SqlClient } from "./db.js";

describe("database-backed login throttling", () => {
  it("isolates identities, locks after repeated failures, and resets the window", async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(
        await readFile(resolve("migrations/009_auth_throttle.sql"), "utf8"),
      );
      const client = {
        query: async (sql: string, params?: unknown[]) => {
          const result = await pg.query(sql, params);
          return {
            ...result,
            rowCount: result.affectedRows ?? result.rows.length,
          };
        },
      } as unknown as SqlClient;
      const key = loginAttemptKey(
        "Tenant-A",
        "Employee@Example.test",
        "test-secret",
      );
      expect(key).toBe(
        loginAttemptKey("tenant-a", "employee@example.test", "test-secret"),
      );
      expect(key).not.toContain("employee");
      const other = loginAttemptKey(
        "tenant-a",
        "other@example.test",
        "test-secret",
      );
      for (let attempt = 0; attempt < 9; attempt += 1)
        await recordLoginFailure(client, key);
      expect(await loginBlocked(client, key)).toBe(false);
      await recordLoginFailure(client, key);
      expect(await loginBlocked(client, key)).toBe(true);
      expect(await loginBlocked(client, other)).toBe(false);
      await pg.query(
        "UPDATE auth_attempts SET window_started_at=now()-interval '16 minutes',locked_until=now()-interval '1 minute' WHERE key_hash=$1",
        [key],
      );
      await recordLoginFailure(client, key);
      expect(await loginBlocked(client, key)).toBe(false);
      const count = await pg.query<{ failure_count: number }>(
        "SELECT failure_count FROM auth_attempts WHERE key_hash=$1",
        [key],
      );
      expect(count.rows[0]?.failure_count).toBe(1);
      await clearLoginFailures(client, key);
      expect(
        (await pg.query("SELECT 1 FROM auth_attempts WHERE key_hash=$1", [key]))
          .rows,
      ).toHaveLength(0);
      await recordLoginFailure(client, other);
      await pg.query(
        "UPDATE auth_attempts SET updated_at=now()-interval '2 days' WHERE key_hash=$1",
        [other],
      );
      expect(await cleanupLoginFailures(client)).toBe(1);
    } finally {
      await pg.close();
    }
  });
});
