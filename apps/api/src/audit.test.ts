import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { audit, verifyAuditChain } from "./audit.js";
import type { SqlClient } from "./db.js";

describe("audit integrity", () => {
  it("verifies event content and distinguishes legacy events", async () => {
    const pg = await PGlite.create();
    try {
      await pg.exec(await readFile(resolve("migrations/001_core.sql"), "utf8"));
      await pg.exec(
        await readFile(resolve("migrations/003_audit_payload.sql"), "utf8"),
      );
      const tenantId = "11111111-1111-4111-8111-111111111111";
      const objectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await pg.query("INSERT INTO tenants(id,slug,name) VALUES ($1,'a','A')", [
        tenantId,
      ]);
      await pg.transaction((tx) =>
        audit(
          tx as unknown as SqlClient,
          tenantId,
          null,
          "TestAction",
          "test",
          objectId,
          { z: 1, a: "two" },
        ),
      );
      for (let index = 0; index < 10; index += 1) {
        await pg.transaction((tx) =>
          audit(
            tx as unknown as SqlClient,
            tenantId,
            null,
            "LaterAction",
            "test",
            objectId,
            { index },
          ),
        );
      }
      const client = pg as unknown as SqlClient;
      expect(await verifyAuditChain(client, tenantId)).toMatchObject({
        status: "VERIFIED",
        eventCount: 11,
        headMatches: true,
      });
      const original = await pg.query<{ created_at: Date }>(
        "SELECT created_at FROM audit_events WHERE tenant_id=$1 AND id=1",
        [tenantId],
      );
      await pg.query(
        "UPDATE audit_events SET created_at=created_at + interval '1 day' WHERE tenant_id=$1 AND id=1",
        [tenantId],
      );
      expect(await verifyAuditChain(client, tenantId)).toMatchObject({
        status: "FAILED",
        firstMismatchId: "1",
      });
      await pg.query(
        "UPDATE audit_events SET created_at=$2 WHERE tenant_id=$1 AND id=1",
        [tenantId, original.rows[0]!.created_at],
      );
      await pg.query(
        "UPDATE audit_events SET detail=$2::jsonb WHERE tenant_id=$1 AND id=1",
        [tenantId, JSON.stringify({ z: 1, a: "altered" })],
      );
      expect(await verifyAuditChain(client, tenantId)).toMatchObject({
        status: "FAILED",
        firstMismatchId: "1",
      });
      await pg.query(
        "UPDATE audit_events SET detail=$2::jsonb,canonical_payload=NULL WHERE tenant_id=$1 AND id=1",
        [tenantId, JSON.stringify({ z: 1, a: "two" })],
      );
      expect(await verifyAuditChain(client, tenantId)).toMatchObject({
        status: "PARTIAL",
        legacyEventCount: 1,
      });
    } finally {
      await pg.close();
    }
  }, 30000);
});
