import { describe, expect, it } from "vitest";
import { describeTrend, type TrendPoint } from "./trend.ts";

const comparable: TrendPoint[] = [
  {
    evaluationId: "jan",
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
    score: "70",
  },
  {
    evaluationId: "feb",
    startsOn: "2026-02-01",
    endsOn: "2026-02-28",
    score: "80",
  },
  {
    evaluationId: "mar",
    startsOn: "2026-03-01",
    endsOn: "2026-03-31",
    score: "90",
  },
];

describe("descriptive longitudinal trend", () => {
  it("uses chronological canonical scores and reports descriptive change only", () => {
    const result = describeTrend([
      comparable[2]!,
      comparable[0]!,
      comparable[1]!,
    ]);
    expect(result.status).toBe("AVAILABLE");
    expect(result.points.map((point) => point.evaluationId)).toEqual([
      "jan",
      "feb",
      "mar",
    ]);
    expect(result.mean).toBe("80.0000");
    expect(result.sampleVolatility).toBe("10.0000");
    expect(result.firstToLastChange).toBe("20.0000");
    expect(Number(result.slopePerYear)).toBeGreaterThan(120);
    expect(Number(result.slopePerYear)).toBeLessThan(130);
  });

  it("withholds a trend for too few, overlapping, or differently sized cycles", () => {
    expect(describeTrend(comparable.slice(0, 2))).toMatchObject({
      status: "INSUFFICIENT",
      slopePerYear: null,
    });
    expect(
      describeTrend([
        comparable[0]!,
        { ...comparable[1]!, startsOn: "2026-01-30" },
        comparable[2]!,
      ]).reason,
    ).toContain("Overlapping");
    expect(
      describeTrend([
        comparable[0]!,
        comparable[1]!,
        { ...comparable[2]!, startsOn: "2026-03-01", endsOn: "2026-06-30" },
      ]).reason,
    ).toContain("25%");
  });

  it("rejects invalid dates and negative scores", () => {
    expect(() =>
      describeTrend([
        comparable[0]!,
        comparable[1]!,
        { ...comparable[2]!, endsOn: "2026-02-30" },
      ]),
    ).toThrow("valid calendar dates");
    expect(() =>
      describeTrend([
        comparable[0]!,
        comparable[1]!,
        { ...comparable[2]!, score: "-1" },
      ]),
    ).toThrow("nonnegative");
  });
});
