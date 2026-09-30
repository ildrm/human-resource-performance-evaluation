import { createHash } from "node:crypto";
import type { SqlClient } from "./db.js";

export async function audit(
  client: SqlClient,
  tenantId: string,
  actorId: string | null,
  action: string,
  objectType: string,
  objectId: string,
  detail: Record<string, unknown> = {},
  reason: string | null = null,
): Promise<void> {
  const state = await client.query<{ audit_hash: string }>(
    "SELECT audit_hash FROM tenants WHERE id = $1 FOR UPDATE",
    [tenantId],
  );
  const previous = state.rows[0]?.audit_hash;
  if (previous === undefined) throw new Error("Tenant does not exist");
  const createdAt = new Date().toISOString();
  const canonical = JSON.stringify({
    tenantId,
    actorId,
    action,
    objectType,
    objectId,
    detail,
    reason,
    createdAt,
  });
  const hash = createHash("sha256")
    .update(previous + canonical)
    .digest("hex");
  await client.query(
    "INSERT INTO audit_events(tenant_id,actor_id,action,object_type,object_id,detail,reason,previous_hash,hash,canonical_payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      tenantId,
      actorId,
      action,
      objectType,
      objectId,
      JSON.stringify(detail),
      reason,
      previous,
      hash,
      canonical,
      createdAt,
    ],
  );
  await client.query("UPDATE tenants SET audit_hash = $2 WHERE id = $1", [
    tenantId,
    hash,
  ]);
  await client.query(
    "INSERT INTO outbox(tenant_id,kind,payload) VALUES ($1,$2,$3)",
    [tenantId, action, JSON.stringify({ objectType, objectId })],
  );
}

export type AuditIntegrity = {
  status: "VERIFIED" | "PARTIAL" | "FAILED";
  eventCount: number;
  legacyEventCount: number;
  firstMismatchId: string | null;
  headMatches: boolean;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return item;
  });
}

export async function verifyAuditChain(
  client: SqlClient,
  tenantId: string,
): Promise<AuditIntegrity> {
  const head = await client.query<{ audit_hash: string }>(
    "SELECT audit_hash FROM tenants WHERE id=$1",
    [tenantId],
  );
  if (!head.rows[0]) throw new Error("Tenant does not exist");
  const events = await client.query<{
    id: string;
    previous_hash: string;
    hash: string;
    canonical_payload: string | null;
    actor_id: string | null;
    action: string;
    object_type: string;
    object_id: string;
    detail: Record<string, unknown>;
    reason: string | null;
    created_at: string | Date;
  }>(
    "SELECT a.id::text,a.previous_hash,a.hash,a.canonical_payload,a.actor_id,a.action,a.object_type,a.object_id,a.detail,a.reason,a.created_at FROM audit_events a WHERE a.tenant_id=$1 ORDER BY a.id",
    [tenantId],
  );
  let previous = "";
  let legacyEventCount = 0;
  let firstMismatchId: string | null = null;
  for (const event of events.rows) {
    if (event.previous_hash !== previous) {
      firstMismatchId = event.id;
      break;
    }
    if (event.canonical_payload === null) {
      legacyEventCount += 1;
    } else {
      let contentMatches = false;
      try {
        contentMatches =
          stableJson(JSON.parse(event.canonical_payload)) ===
          stableJson({
            tenantId,
            actorId: event.actor_id,
            action: event.action,
            objectType: event.object_type,
            objectId: event.object_id,
            detail: event.detail,
            reason: event.reason,
            createdAt: new Date(event.created_at).toISOString(),
          });
      } catch {
        contentMatches = false;
      }
      const expected = createHash("sha256")
        .update(previous + event.canonical_payload)
        .digest("hex");
      if (!contentMatches || event.hash !== expected) {
        firstMismatchId = event.id;
        break;
      }
    }
    previous = event.hash;
  }
  const headMatches = previous === head.rows[0].audit_hash;
  return {
    status:
      firstMismatchId || !headMatches
        ? "FAILED"
        : legacyEventCount
          ? "PARTIAL"
          : "VERIFIED",
    eventCount: events.rows.length,
    legacyEventCount,
    firstMismatchId,
    headMatches,
  };
}
