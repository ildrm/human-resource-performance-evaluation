import assert from "node:assert/strict";
import {
  calculate,
  calculateEvidenceQuality,
  type EvaluationInput,
  type EvidenceQualityInput,
} from "@hpi/calculation-engine";
import { Client } from "pg";

const liveUrl = process.env.DATABASE_URL;
const restoreName = process.env.RESTORE_DATABASE_NAME;
if (!liveUrl || !restoreName || !/^hpi_restore_[a-z0-9_]+$/.test(restoreName))
  throw new Error(
    "DATABASE_URL and a scratch RESTORE_DATABASE_NAME beginning with hpi_restore_ are required",
  );
const target = new URL(liveUrl);
if (target.pathname === `/${restoreName}`)
  throw new Error(
    "Restore verification must target a separate scratch database",
  );
target.pathname = `/${restoreName}`;

type SavedEvaluation = {
  score: string | null;
  input_snapshot: EvaluationInput;
  result_snapshot: { score: string | null; status: string };
  quality_input_snapshot: EvidenceQualityInput | null;
  quality_result_snapshot: { index: string; policyVersion: number } | null;
};

const client = new Client({
  connectionString: target.toString(),
  statement_timeout: 15000,
});
let tenantsChecked = 0;
let evaluationsReplayed = 0;
let qualityResultsReplayed = 0;
try {
  await client.connect();
  const tenants = await client.query<{ id: string }>(
    "SELECT id FROM tenants ORDER BY id",
  );
  for (const tenant of tenants.rows) {
    await client.query("BEGIN READ ONLY");
    try {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        tenant.id,
      ]);
      const evaluations = await client.query<SavedEvaluation>(
        "SELECT score::text,input_snapshot,result_snapshot,quality_input_snapshot,quality_result_snapshot FROM evaluations WHERE tenant_id=$1 ORDER BY id LIMIT 10001",
        [tenant.id],
      );
      if (evaluations.rows.length > 10000)
        throw new Error(
          "More than 10,000 evaluations in one tenant; run a paginated restore replay",
        );
      for (const saved of evaluations.rows) {
        const replayed = calculate(saved.input_snapshot);
        assert.equal(
          replayed.score,
          saved.result_snapshot.score,
          "Frozen score differs from restored result",
        );
        assert.equal(
          replayed.score,
          saved.score,
          "Frozen score differs from restored canonical column",
        );
        assert.equal(
          replayed.status,
          saved.result_snapshot.status,
          "Frozen status differs from restored result",
        );
        if (saved.quality_input_snapshot) {
          assert.ok(
            saved.quality_result_snapshot,
            "Quality input has no saved result",
          );
          const quality = calculateEvidenceQuality(
            saved.quality_input_snapshot,
          );
          assert.equal(
            quality.index,
            saved.quality_result_snapshot.index,
            "Quality index differs after restore",
          );
          assert.equal(
            quality.policyVersion,
            saved.quality_result_snapshot.policyVersion,
            "Quality policy version differs after restore",
          );
          qualityResultsReplayed += 1;
        } else {
          assert.equal(
            saved.quality_result_snapshot,
            null,
            "Quality result has no frozen input",
          );
        }
        evaluationsReplayed += 1;
      }
      await client.query("COMMIT");
      tenantsChecked += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(
    JSON.stringify({
      status: "passed",
      tenantsChecked,
      evaluationsReplayed,
      qualityResultsReplayed,
    }),
  );
} finally {
  await client.end();
}
