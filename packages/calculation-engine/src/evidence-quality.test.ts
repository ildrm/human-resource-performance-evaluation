import { describe, expect, it } from "vitest";
import {
  calculateEvidenceQuality,
  type EvidenceQualityInput,
} from "./evidence-quality.js";

const input: EvidenceQualityInput = {
  policy: {
    id: "local-policy",
    version: 1,
    freshnessDays: 10,
    unreferencedEvidenceFactor: "0.5",
    weights: {
      completeness: "0.25",
      freshness: "0.25",
      sampleAdequacy: "0.25",
      traceability: "0.25",
    },
  },
  cycleEnd: "2026-01-10",
  metrics: [
    {
      metricId: "a",
      required: true,
      state: "OBSERVED",
      observedAt: "2026-01-05T23:59:59.999Z",
      externalReferencePresent: true,
      minimumSample: 10,
      denominator: "5",
    },
    {
      metricId: "b",
      required: true,
      state: "MISSING",
      externalReferencePresent: false,
      minimumSample: 0,
    },
  ],
};

describe("Evidence Quality Index", () => {
  it("exposes each versioned heuristic component separately", () => {
    expect(calculateEvidenceQuality(input)).toMatchObject({
      policyVersion: 1,
      index: "62.50",
      components: {
        completeness: "0.5000",
        freshness: "0.5000",
        sampleAdequacy: "0.5000",
        traceability: "1.0000",
      },
    });
  });
  it("discloses the configured penalty for a missing external reference", () => {
    const changed: EvidenceQualityInput = {
      ...input,
      metrics: [
        { ...input.metrics[0]!, externalReferencePresent: false },
        input.metrics[1]!,
      ],
    };
    expect(calculateEvidenceQuality(changed)).toMatchObject({
      index: "50.00",
      components: { traceability: "0.5000" },
    });
  });
  it("rejects invalid weights and future observations", () => {
    expect(() =>
      calculateEvidenceQuality({
        ...input,
        policy: {
          ...input.policy,
          weights: { ...input.policy.weights, completeness: "0.3" },
        },
      }),
    ).toThrow("weights summing to 1");
    expect(() =>
      calculateEvidenceQuality({
        ...input,
        metrics: [{ ...input.metrics[0]!, observedAt: "2026-01-11T00:00:00Z" }],
      }),
    ).toThrow("after cycle end");
  });
});
