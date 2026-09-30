import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

export function snapshotHash(value: unknown): string {
  return createHash("sha256")
    .update(canonical(JSON.parse(JSON.stringify(value))))
    .digest("hex");
}

/** Hash the TypeScript sources executed by the current package export. */
export const currentEngineArtifactHash = createHash("sha256")
  .update(
    readFileSync(
      new URL(
        "../../../packages/calculation-engine/src/versioned.ts",
        import.meta.url,
      ),
    ),
  )
  .update(
    readFileSync(
      new URL(
        "../../../packages/calculation-engine/src/index.ts",
        import.meta.url,
      ),
    ),
  )
  .update(
    readFileSync(
      new URL(
        "../../../packages/calculation-engine/src/proportion.ts",
        import.meta.url,
      ),
    ),
  )
  .digest("hex");
