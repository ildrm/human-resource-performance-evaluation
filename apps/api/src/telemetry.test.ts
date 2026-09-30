import { describe, expect, it } from "vitest";
import { routeTemplate, safeCorrelationId, safeTraceId } from "./telemetry.js";

describe("privacy-safe telemetry identifiers", () => {
  it("rejects unbounded or personal text in a caller-supplied correlation header", () => {
    const supplied = "123e4567-e89b-42d3-a456-426614174000";
    expect(safeCorrelationId(supplied)).toBe(supplied);
    for (const malicious of [
      "person@example.test",
      "x".repeat(10000),
      [supplied],
      "name\nfield",
    ])
      expect(safeCorrelationId(malicious)).toMatch(uuidPattern);
  });

  it("uses only valid nonzero trace contexts and configured route templates", () => {
    const id = "123e4567e89b42d3a456426614174000";
    expect(safeTraceId(`00-${id}-123e4567e89b42d3-01`)).toBe(id);
    expect(safeTraceId(`00-${"0".repeat(32)}-123e4567e89b42d3-01`)).not.toBe(
      "0".repeat(32),
    );
    expect(routeTemplate("/v1/people/:id/trends")).toBe(
      "/v1/people/:id/trends",
    );
    expect(routeTemplate("/v1/people/private@example.test")).toBe("unmatched");
  });
});

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
