import { Decimal } from "decimal.js";
import type { ObservationState } from "./index.ts";

export type EvidenceQualityPolicy = Readonly<{
  id: string;
  version: number;
  freshnessDays: number;
  unreferencedEvidenceFactor: string;
  weights: Readonly<{
    completeness: string;
    freshness: string;
    sampleAdequacy: string;
    traceability: string;
  }>;
}>;
export type EvidenceQualityMetric = Readonly<{
  metricId: string;
  required: boolean;
  state: ObservationState;
  observedAt?: string;
  externalReferencePresent: boolean;
  minimumSample: number;
  denominator?: string;
}>;
export type EvidenceQualityInput = Readonly<{
  policy: EvidenceQualityPolicy;
  cycleEnd: string;
  metrics: readonly EvidenceQualityMetric[];
}>;
export type EvidenceQualityResult = Readonly<{
  name: "Evidence Quality Index";
  policyId: string;
  policyVersion: number;
  index: string;
  components: Readonly<{
    completeness: string;
    freshness: string;
    sampleAdequacy: string;
    traceability: string;
  }>;
  metricTrace: readonly {
    metricId: string;
    observed: boolean;
    freshness: string | null;
    sampleAdequacy: string | null;
    traceability: string | null;
  }[];
  interpretation: string;
}>;

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** A disclosed policy index. It is neither a probability nor a confidence interval. */
export function calculateEvidenceQuality(
  input: EvidenceQualityInput,
): EvidenceQualityResult {
  const weights = Object.values(input.policy.weights).map(
    (value) => new Decimal(value),
  );
  if (
    input.metrics.length === 0 ||
    weights.some((weight) => weight.lte(0)) ||
    !weights.reduce((sum, weight) => sum.plus(weight), new Decimal(0)).eq(1)
  )
    throw new Error(
      "Quality policy needs positive weights summing to 1 and metrics",
    );
  if (
    !Number.isInteger(input.policy.freshnessDays) ||
    input.policy.freshnessDays < 1
  )
    throw new Error("Freshness window must be a positive whole number");
  const unreferenced = new Decimal(input.policy.unreferencedEvidenceFactor);
  if (unreferenced.lt(0) || unreferenced.gt(1))
    throw new Error("Unreferenced factor must be between 0 and 1");
  const end = Date.parse(`${input.cycleEnd}T23:59:59.999Z`);
  if (!Number.isFinite(end)) throw new Error("Cycle end is invalid");
  const relevant = input.metrics.some((metric) => metric.required)
    ? input.metrics.filter((metric) => metric.required)
    : input.metrics;
  const trace = input.metrics.map((metric) => {
    const observed =
      (metric.state === "OBSERVED" || metric.state === "ZERO") &&
      metric.observedAt !== undefined;
    if (!observed)
      return {
        metricId: metric.metricId,
        observed: false,
        freshness: null,
        sampleAdequacy: null,
        traceability: null,
      };
    const observedAt = Date.parse(metric.observedAt!);
    if (!Number.isFinite(observedAt) || observedAt > end)
      throw new Error("Evidence time falls after cycle end or is invalid");
    const ageDays = new Decimal(end - observedAt).div(86_400_000);
    const freshness = Decimal.max(
      0,
      new Decimal(1).minus(ageDays.div(input.policy.freshnessDays)),
    );
    const adequacy =
      metric.minimumSample === 0
        ? new Decimal(1)
        : metric.denominator === undefined
          ? new Decimal(0)
          : Decimal.min(
              1,
              new Decimal(metric.denominator).div(metric.minimumSample),
            );
    if (adequacy.lt(0))
      throw new Error("Sample denominator must be nonnegative");
    return {
      metricId: metric.metricId,
      observed: true,
      freshness: fixed(freshness),
      sampleAdequacy: fixed(adequacy),
      traceability: fixed(
        metric.externalReferencePresent ? new Decimal(1) : unreferenced,
      ),
    };
  });
  const available = trace.filter((item) => item.observed);
  const mean = (field: "freshness" | "sampleAdequacy" | "traceability") =>
    available.length
      ? available
          .reduce((sum, item) => sum.plus(item[field] ?? 0), new Decimal(0))
          .div(available.length)
      : new Decimal(0);
  const components = {
    completeness: fixed(
      new Decimal(
        relevant.filter(
          (metric) =>
            trace.find((item) => item.metricId === metric.metricId)?.observed,
        ).length,
      ).div(relevant.length),
    ),
    freshness: fixed(mean("freshness")),
    sampleAdequacy: fixed(mean("sampleAdequacy")),
    traceability: fixed(mean("traceability")),
  };
  const index = Object.entries(components).reduce(
    (sum, [key, value]) =>
      sum.plus(
        new Decimal(value).times(
          input.policy.weights[key as keyof typeof input.policy.weights],
        ),
      ),
    new Decimal(0),
  );
  return {
    name: "Evidence Quality Index",
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    index: index
      .times(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toFixed(2),
    components,
    metricTrace: trace,
    interpretation:
      "Tenant-configured descriptive evidence quality index. It is not a probability, statistical confidence interval, or validation of the performance score.",
  };
}
