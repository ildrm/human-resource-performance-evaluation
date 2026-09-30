import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calculate, interpolate, type EvaluationInput } from "./index.js";

const anchors = [
  { actual: "0", score: "0" },
  { actual: "10", score: "100" },
  { actual: "20", score: "120" },
];

describe("versioned interpolation", () => {
  it("interpolates, floors, and caps decimal scores", () => {
    expect(interpolate("5", anchors, "HIGHER")).toBe("50.0000");
    expect(interpolate("-3", anchors, "HIGHER")).toBe("0.0000");
    expect(interpolate("30", anchors, "HIGHER")).toBe("120.0000");
  });
  it("is monotonic for higher-is-better anchors", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (a, b) => {
          if (a <= b)
            expect(
              Number(interpolate(String(a), anchors, "HIGHER")),
            ).toBeLessThanOrEqual(
              Number(interpolate(String(b), anchors, "HIGHER")),
            );
        },
      ),
    );
  });
  it("rejects an invalid lower-is-better formula", () => {
    expect(() => interpolate("1", anchors, "LOWER")).toThrow("monotonic");
  });
  it("is monotonic in the correct direction for lower-is-better anchors", () => {
    const lower = [
      { actual: "0", score: "120" },
      { actual: "10", score: "100" },
      { actual: "20", score: "0" },
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: -20, max: 40 }),
        fc.integer({ min: -20, max: 40 }),
        (a, b) => {
          if (a <= b)
            expect(
              Number(interpolate(String(a), lower, "LOWER")),
            ).toBeGreaterThanOrEqual(
              Number(interpolate(String(b), lower, "LOWER")),
            );
        },
      ),
    );
  });
});

describe("aggregation", () => {
  const base: EvaluationInput = {
    formulaVersion: "1.0.0",
    dimensions: [
      {
        name: "Quality",
        weight: "1",
        metrics: [
          {
            metricId: "a",
            metricName: "Accuracy",
            weight: "0.75",
            required: true,
            direction: "HIGHER",
            state: "OBSERVED",
            actual: "10",
            targetId: "t1",
            anchors,
          },
          {
            metricId: "b",
            metricName: "Service",
            weight: "0.25",
            required: false,
            direction: "HIGHER",
            state: "MISSING",
          },
        ],
      },
    ],
  };
  it("documents redistribution of optional missing weight", () => {
    const result = calculate(base);
    expect(result.status).toBe("COMPLETE");
    expect(result.score).toBe("100.0000");
    expect(result.dimensions[0]?.metrics[0]?.appliedWeight).toBe("1.0000");
  });
  it("never turns required missing evidence into zero", () => {
    const result = calculate({
      ...base,
      dimensions: [
        {
          ...base.dimensions[0]!,
          metrics: [
            { ...base.dimensions[0]!.metrics[0]!, state: "MISSING" },
            base.dimensions[0]!.metrics[1]!,
          ],
        },
      ],
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.score).toBeNull();
  });
  it("treats an observed zero as scorable", () => {
    const result = calculate({
      formulaVersion: "1",
      dimensions: [
        {
          name: "Q",
          weight: "1",
          metrics: [
            {
              ...base.dimensions[0]!.metrics[0]!,
              weight: "1",
              state: "ZERO",
              actual: "0",
            },
          ],
        },
      ],
    });
    expect(result.score).toBe("0.0000");
  });
  it("reproduces a hand-calculated two-dimension fixture", () => {
    const result = calculate({
      formulaVersion: "golden-1",
      dimensions: [
        {
          name: "Delivery",
          weight: "0.6",
          metrics: [
            {
              metricId: "delivery",
              metricName: "Delivery",
              weight: "1",
              required: true,
              direction: "HIGHER",
              state: "OBSERVED",
              actual: "8",
              targetId: "d",
              anchors,
            },
          ],
        },
        {
          name: "Quality",
          weight: "0.4",
          metrics: [
            {
              metricId: "quality",
              metricName: "Quality",
              weight: "1",
              required: true,
              direction: "HIGHER",
              state: "OBSERVED",
              actual: "9",
              targetId: "q",
              anchors,
            },
          ],
        },
      ],
    });
    expect(result.score).toBe("84.0000");
    expect(result.dimensions.map((d) => d.contribution)).toEqual([
      "48.0000",
      "36.0000",
    ]);
  });
  it("redistributes optional insufficient samples but blocks required ones", () => {
    const metric = {
      ...base.dimensions[0]!.metrics[0]!,
      minimumSample: 10,
      denominator: "3",
    };
    const required = calculate({
      formulaVersion: "1",
      dimensions: [
        { name: "Q", weight: "1", metrics: [{ ...metric, weight: "1" }] },
      ],
    });
    expect(required.status).toBe("INCOMPLETE");
    expect(required.dimensions[0]?.metrics[0]?.state).toBe(
      "INSUFFICIENT_SAMPLE",
    );
    const optional = calculate({
      formulaVersion: "1",
      dimensions: [
        {
          name: "Q",
          weight: "1",
          metrics: [
            { ...metric, weight: "0.5", required: false },
            {
              ...metric,
              metricId: "other",
              metricName: "Other",
              weight: "0.5",
              denominator: "12",
            },
          ],
        },
      ],
    });
    expect(optional.score).toBe("100.0000");
  });
});
