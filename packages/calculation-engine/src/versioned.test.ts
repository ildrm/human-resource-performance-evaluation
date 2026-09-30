import { describe, expect, it } from "vitest";
import {
  calculateV2,
  replayVersioned,
  type VersionedEvaluationInput,
} from "./versioned.ts";

const oldTarget = [
  { actual: "0", score: "0" },
  { actual: "10", score: "100" },
];
const newTarget = [
  { actual: "0", score: "0" },
  { actual: "20", score: "100" },
];

function input(
  overrides: Partial<
    VersionedEvaluationInput["dimensions"][number]["metrics"][number]
  > = {},
): VersionedEvaluationInput {
  return {
    engineVersion: "2.0.0",
    inputSchemaVersion: 2,
    formulaVersion: "template:1",
    dimensions: [
      {
        name: "Output",
        weight: "1",
        missingWeightPolicy: { version: 1, mode: "BLOCK" },
        metrics: [
          {
            metricId: "metric",
            metricName: "Output",
            direction: "HIGHER",
            weight: "1",
            required: true,
            periodAggregation: "MEAN_SCORE",
            minimumObservations: 2,
            observations: [
              {
                evidenceId: "e1",
                observedAt: "2026-01-10T00:00:00.000Z",
                state: "OBSERVED",
                actual: "10",
                targetId: "t1",
                targetVersion: 1,
                anchors: oldTarget,
              },
              {
                evidenceId: "e2",
                observedAt: "2026-02-10T00:00:00.000Z",
                state: "OBSERVED",
                actual: "10",
                targetId: "t2",
                targetVersion: 2,
                anchors: newTarget,
              },
            ],
            ...overrides,
          },
        ],
      },
    ],
  };
}

describe("versioned production calculation", () => {
  it("scores each observation against its effective target and retains both sources", () => {
    const result = calculateV2(input());
    expect(result.score).toBe("75.0000");
    expect(
      result.dimensions[0]!.metrics[0]!.observations.map((row) => [
        row.evidenceId,
        row.targetId,
        row.score,
      ]),
    ).toEqual([
      ["e1", "t1", "100.0000"],
      ["e2", "t2", "50.0000"],
    ]);
    expect(replayVersioned(input())).toEqual(result);
  });

  it("requires an explicit redistribution policy for optional missing weight", () => {
    const original = input({
      minimumObservations: 1,
      periodAggregation: "LATEST",
    });
    const first = original.dimensions[0]!.metrics[0]!;
    const missing = {
      ...first,
      metricId: "missing",
      weight: "0.25",
      required: false,
      observations: [],
    };
    const blocked = calculateV2({
      ...original,
      dimensions: [
        {
          ...original.dimensions[0]!,
          metrics: [{ ...first, weight: "0.75" }, missing],
        },
      ],
    });
    expect(blocked.status).toBe("INCOMPLETE");
    expect(blocked.score).toBeNull();
    const redistributed = calculateV2({
      ...original,
      dimensions: [
        {
          ...original.dimensions[0]!,
          missingWeightPolicy: { version: 2, mode: "REDISTRIBUTE" },
          metrics: [{ ...first, weight: "0.75" }, missing],
        },
      ],
    });
    expect(redistributed.score).toBe("50.0000");
    expect(redistributed.dimensions[0]!.metrics[0]!.appliedWeight).toBe(
      "1.0000",
    );
  });

  it("rejects fractional binary values and interpolation of rubric levels", () => {
    const binary = input({
      direction: "BINARY",
      minimumObservations: 1,
      periodAggregation: "LATEST",
      observations: [
        {
          evidenceId: "e",
          observedAt: "2026-02-10T00:00:00.000Z",
          state: "OBSERVED",
          actual: "0.5",
          targetId: "t",
          anchors: [
            { actual: "0", score: "0" },
            { actual: "1", score: "100" },
          ],
        },
      ],
    });
    expect(() => calculateV2(binary)).toThrow("exactly 0 or 1");
    const rubric = input({
      ...binary.dimensions[0]!.metrics[0]!,
      direction: "RUBRIC",
      observations: [
        {
          ...binary.dimensions[0]!.metrics[0]!.observations[0]!,
          anchors: [
            { actual: "1", score: "20" },
            { actual: "2", score: "40" },
          ],
        },
      ],
    });
    expect(() => calculateV2(rubric)).toThrow("positive integer levels");
  });
});
