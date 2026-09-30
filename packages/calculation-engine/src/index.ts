import { Decimal } from "decimal.js";
import { wilson95, type ProportionInterval } from "./proportion.ts";
export * from "./evidence-quality.ts";
export * from "./proportion.ts";
export * from "./trend.ts";
export * from "./versioned.ts";

Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});

export type Anchor = Readonly<{ actual: string; score: string }>;
export type ObservationState =
  | "OBSERVED"
  | "ZERO"
  | "NOT_APPLICABLE"
  | "NOT_MEASURED"
  | "MISSING"
  | "INVALID"
  | "INSUFFICIENT_SAMPLE"
  | "SUPPRESSED"
  | "UNAVAILABLE_DUE_TO_DISRUPTION";
export type MetricInput = Readonly<{
  metricId: string;
  metricName: string;
  weight: string;
  required: boolean;
  direction: "HIGHER" | "LOWER" | "RANGE" | "BINARY" | "MILESTONE" | "RUBRIC";
  state: ObservationState;
  actual?: string;
  evidenceId?: string;
  targetId?: string;
  targetVersion?: number;
  anchors?: readonly Anchor[];
  minimumSample?: number;
  denominator?: string;
  numerator?: string;
  measurementKind?: "CONTINUOUS" | "BINOMIAL_PROPORTION";
}>;
export type DimensionInput = Readonly<{
  name: string;
  weight: string;
  metrics: readonly MetricInput[];
}>;
export type EvaluationInput = Readonly<{
  formulaVersion: string;
  dimensions: readonly DimensionInput[];
}>;

export type MetricTrace = {
  metricId: string;
  metricName: string;
  state: ObservationState;
  required: boolean;
  configuredWeight: string;
  appliedWeight: string | null;
  actual: string | null;
  score: string | null;
  contribution: string | null;
  evidenceId: string | null;
  targetId: string | null;
  targetVersion: number | null;
  anchors: readonly Anchor[] | null;
  note: string | null;
  proportionInterval: ProportionInterval | null;
};
export type DimensionTrace = {
  name: string;
  weight: string;
  score: string | null;
  contribution: string | null;
  metrics: MetricTrace[];
};
export type EvaluationResult = {
  status: "COMPLETE" | "INCOMPLETE";
  score: string | null;
  formulaVersion: string;
  dimensions: DimensionTrace[];
  issues: string[];
};

function exactWeightSum(weights: readonly string[]): void {
  if (
    weights.length === 0 ||
    !weights.reduce((sum, value) => sum.plus(value), new Decimal(0)).eq(1)
  ) {
    throw new Error("Configured weights must sum to exactly 1");
  }
  if (weights.some((value) => new Decimal(value).lte(0)))
    throw new Error("Weights must be positive");
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(4).toFixed(4);
}

/** The anchor table is a tenant-approved policy, not a scientifically validated universal scale. */
export function interpolate(
  actual: string,
  anchors: readonly Anchor[],
  direction: MetricInput["direction"],
): string {
  if (anchors.length < 2) throw new Error("At least two anchors are required");
  const points = anchors.map(({ actual: x, score: y }) => ({
    x: new Decimal(x),
    y: new Decimal(y),
  }));
  for (let i = 1; i < points.length; i += 1) {
    if (!points[i]!.x.gt(points[i - 1]!.x))
      throw new Error("Anchor actual values must strictly increase");
    if (direction === "HIGHER" && points[i]!.y.lt(points[i - 1]!.y))
      throw new Error("Higher-is-better anchors must be monotonic");
    if (direction === "LOWER" && points[i]!.y.gt(points[i - 1]!.y))
      throw new Error("Lower-is-better anchors must be monotonic");
  }
  const x = new Decimal(actual);
  if (!x.isFinite()) throw new Error("Actual must be finite");
  if (x.lte(points[0]!.x)) return fixed(points[0]!.y);
  const last = points[points.length - 1]!;
  if (x.gte(last.x)) return fixed(last.y);
  const upper = points.findIndex((point) => x.lte(point.x));
  const left = points[upper - 1]!;
  const right = points[upper]!;
  return fixed(
    left.y.plus(
      x.minus(left.x).div(right.x.minus(left.x)).times(right.y.minus(left.y)),
    ),
  );
}

export function calculate(input: EvaluationInput): EvaluationResult {
  exactWeightSum(input.dimensions.map((dimension) => dimension.weight));
  const issues: string[] = [];
  const dimensionTraces: DimensionTrace[] = [];
  let total = new Decimal(0);
  for (const dimension of input.dimensions) {
    exactWeightSum(dimension.metrics.map((metric) => metric.weight));
    const available: { metric: MetricInput; score: Decimal }[] = [];
    const insufficientSamples = new Set<string>();
    for (const metric of dimension.metrics) {
      if (metric.state === "OBSERVED" || metric.state === "ZERO") {
        if (
          metric.actual === undefined ||
          !metric.anchors ||
          !metric.targetId
        ) {
          issues.push(
            `${metric.metricName}: actual, approved target, or anchors missing`,
          );
          continue;
        }
        if (metric.state === "ZERO" && !new Decimal(metric.actual).eq(0))
          throw new Error("ZERO state requires actual 0");
        if (
          metric.minimumSample &&
          (metric.denominator === undefined ||
            new Decimal(metric.denominator).lt(metric.minimumSample))
        ) {
          insufficientSamples.add(metric.metricId);
          if (metric.required)
            issues.push(`${metric.metricName}: insufficient sample`);
          continue;
        }
        available.push({
          metric,
          score: new Decimal(
            interpolate(metric.actual, metric.anchors, metric.direction),
          ),
        });
      } else if (metric.required) {
        issues.push(`${metric.metricName}: ${metric.state}`);
      }
    }
    const availableWeight = available.reduce(
      (sum, item) => sum.plus(item.metric.weight),
      new Decimal(0),
    );
    if (availableWeight.eq(0))
      issues.push(`${dimension.name}: no scorable metrics`);
    const metricTraces: MetricTrace[] = dimension.metrics.map((metric) => {
      const found = available.find(
        (item) => item.metric.metricId === metric.metricId,
      );
      const appliedWeight = found
        ? new Decimal(metric.weight).div(availableWeight)
        : null;
      return {
        metricId: metric.metricId,
        metricName: metric.metricName,
        state: insufficientSamples.has(metric.metricId)
          ? "INSUFFICIENT_SAMPLE"
          : metric.state,
        required: metric.required,
        configuredWeight: metric.weight,
        appliedWeight: appliedWeight ? fixed(appliedWeight) : null,
        actual: metric.actual ?? null,
        score: found ? fixed(found.score) : null,
        contribution:
          found && appliedWeight
            ? fixed(found.score.times(appliedWeight))
            : null,
        evidenceId: metric.evidenceId ?? null,
        targetId: metric.targetId ?? null,
        targetVersion: metric.targetVersion ?? null,
        anchors: metric.anchors ?? null,
        note: insufficientSamples.has(metric.metricId)
          ? "Sample is below the configured minimum"
          : found && !availableWeight.eq(1)
            ? "Optional unavailable weight redistributed among scorable metrics"
            : null,
        proportionInterval:
          metric.measurementKind === "BINOMIAL_PROPORTION" &&
          metric.numerator !== undefined &&
          metric.denominator !== undefined
            ? wilson95(metric.numerator, metric.denominator)
            : null,
      };
    });
    const dimensionScore = availableWeight.gt(0)
      ? available
          .reduce(
            (sum, item) => sum.plus(item.score.times(item.metric.weight)),
            new Decimal(0),
          )
          .div(availableWeight)
      : null;
    const contribution = dimensionScore?.times(dimension.weight) ?? null;
    if (contribution) total = total.plus(contribution);
    dimensionTraces.push({
      name: dimension.name,
      weight: dimension.weight,
      score: dimensionScore ? fixed(dimensionScore) : null,
      contribution: contribution ? fixed(contribution) : null,
      metrics: metricTraces,
    });
  }
  return {
    status: issues.length ? "INCOMPLETE" : "COMPLETE",
    score: issues.length ? null : fixed(total),
    formulaVersion: input.formulaVersion,
    dimensions: dimensionTraces,
    issues,
  };
}
