import { Decimal } from "decimal.js";
import {
  calculate,
  interpolate,
  type Anchor,
  type MetricInput,
  type ObservationState,
} from "./index.ts";
import { wilson95, type ProportionInterval } from "./proportion.ts";

/** Kept executable for results written before the versioned calculation format. */
export const LEGACY_ENGINE_VERSION = "1.0.0";
export const CURRENT_ENGINE_VERSION = "2.0.0";
export const CURRENT_INPUT_SCHEMA_VERSION = 2;

export type PeriodAggregation = "LATEST" | "MEAN_SCORE";
export type MissingWeightPolicy = Readonly<{
  version: number;
  mode: "BLOCK" | "REDISTRIBUTE";
}>;
export type ScoringObservation = Readonly<{
  evidenceId: string;
  observedAt: string;
  state: ObservationState;
  actual?: string;
  numerator?: string;
  denominator?: string;
  targetId?: string;
  targetVersion?: number;
  anchors?: readonly Anchor[];
}>;
export type VersionedMetricInput = Omit<MetricInput, "state"> &
  Readonly<{
    periodAggregation: PeriodAggregation;
    minimumObservations: number;
    observations: readonly ScoringObservation[];
  }>;
export type VersionedEvaluationInput = Readonly<{
  engineVersion: typeof CURRENT_ENGINE_VERSION;
  inputSchemaVersion: typeof CURRENT_INPUT_SCHEMA_VERSION;
  formulaVersion: string;
  dimensions: readonly Readonly<{
    name: string;
    weight: string;
    missingWeightPolicy: MissingWeightPolicy;
    metrics: readonly VersionedMetricInput[];
  }>[];
}>;
export type ScoredObservation = ScoringObservation &
  Readonly<{ score: string | null }>;
export type VersionedMetricTrace = Readonly<{
  metricId: string;
  metricName: string;
  configuredWeight: string;
  appliedWeight: string | null;
  required: boolean;
  periodAggregation: PeriodAggregation;
  minimumObservations: number;
  observations: readonly ScoredObservation[];
  score: string | null;
  contribution: string | null;
  proportionInterval: ProportionInterval | null;
}>;
export type VersionedEvaluationResult = Readonly<{
  engineVersion: typeof CURRENT_ENGINE_VERSION;
  inputSchemaVersion: typeof CURRENT_INPUT_SCHEMA_VERSION;
  formulaVersion: string;
  roundingPolicy: "HALF_UP_4DP_PER_OBSERVATION_AND_OUTPUT";
  status: "COMPLETE" | "INCOMPLETE";
  score: string | null;
  dimensions: readonly Readonly<{
    name: string;
    weight: string;
    missingWeightPolicy: MissingWeightPolicy;
    score: string | null;
    contribution: string | null;
    metrics: readonly VersionedMetricTrace[];
  }>[];
  issues: readonly string[];
}>;

function finite(value: string): Decimal {
  const number = new Decimal(value);
  if (!number.isFinite()) throw new Error("Numeric input must be finite");
  return number;
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function checkWeights(weights: readonly string[]): void {
  if (
    weights.length === 0 ||
    weights.some((weight) => finite(weight).lte(0)) ||
    !weights.reduce((sum, weight) => sum.plus(weight), new Decimal(0)).eq(1)
  )
    throw new Error("Configured weights must be positive and sum to exactly 1");
}

function scoreObservation(
  metric: VersionedMetricInput,
  observation: ScoringObservation,
): string | null {
  if (observation.state !== "OBSERVED" && observation.state !== "ZERO")
    return null;
  if (
    !observation.targetId ||
    !observation.anchors ||
    observation.actual === undefined
  )
    return null;
  const actual = finite(observation.actual);
  if (observation.state === "ZERO" && !actual.eq(0))
    throw new Error("ZERO state requires actual 0");
  if (
    metric.minimumSample &&
    (observation.denominator === undefined ||
      finite(observation.denominator).lt(metric.minimumSample))
  )
    return null;
  if (["BINARY", "MILESTONE", "RUBRIC"].includes(metric.direction)) {
    if (metric.direction === "BINARY" && !actual.eq(0) && !actual.eq(1))
      throw new Error("Binary observations must be exactly 0 or 1");
    if (metric.direction === "RUBRIC" && (!actual.isInteger() || actual.lt(1)))
      throw new Error(
        "Rubric observations must use approved positive integer levels",
      );
    if (
      metric.direction === "RUBRIC" &&
      observation.anchors.some(
        (anchor) =>
          !finite(anchor.actual).isInteger() || finite(anchor.actual).lt(1),
      )
    )
      throw new Error("Rubric anchors must use positive integer levels");
    const exact = observation.anchors.find((anchor) =>
      finite(anchor.actual).eq(actual),
    );
    if (!exact) throw new Error("Discrete observation has no approved anchor");
    if (metric.direction === "BINARY") {
      const domain = observation.anchors.map((anchor) => finite(anchor.actual));
      if (
        domain.length !== 2 ||
        !domain.some((point) => point.eq(0)) ||
        !domain.some((point) => point.eq(1))
      )
        throw new Error("Binary anchors must define exactly 0 and 1");
    }
    return fixed(finite(exact.score));
  }
  return interpolate(observation.actual, observation.anchors, metric.direction);
}

export function calculateV2(
  input: VersionedEvaluationInput,
): VersionedEvaluationResult {
  if (
    input.engineVersion !== CURRENT_ENGINE_VERSION ||
    input.inputSchemaVersion !== CURRENT_INPUT_SCHEMA_VERSION
  )
    throw new Error("Unsupported calculation input version");
  checkWeights(input.dimensions.map((dimension) => dimension.weight));
  const issues: string[] = [];
  let total = new Decimal(0);
  const dimensions = input.dimensions.map((dimension) => {
    checkWeights(dimension.metrics.map((metric) => metric.weight));
    if (dimension.missingWeightPolicy.version < 1)
      throw new Error("Missing-weight policy must have an approved version");
    const computed = dimension.metrics.map((metric) => {
      if (
        !Number.isInteger(metric.minimumObservations) ||
        metric.minimumObservations < 1
      )
        throw new Error("Minimum observations must be a positive integer");
      const observations = metric.observations.map((observation) => ({
        ...observation,
        score: scoreObservation(metric, observation),
      }));
      const selected =
        metric.periodAggregation === "LATEST"
          ? observations.slice(-1)
          : observations;
      if (!["LATEST", "MEAN_SCORE"].includes(metric.periodAggregation))
        throw new Error("Unsupported period aggregation policy");
      const complete =
        observations.length >= metric.minimumObservations &&
        selected.every((observation) => observation.score !== null);
      const score = complete
        ? selected
            .reduce(
              (sum, observation) => sum.plus(observation.score!),
              new Decimal(0),
            )
            .div(selected.length)
        : null;
      if (!score && metric.required)
        issues.push(
          `${metric.metricName}: insufficient approved observations or targets`,
        );
      return { metric, observations, score };
    });
    const availableWeight = computed.reduce(
      (sum, item) => (item.score ? sum.plus(item.metric.weight) : sum),
      new Decimal(0),
    );
    if (availableWeight.eq(0))
      issues.push(`${dimension.name}: no scorable metrics`);
    if (availableWeight.lt(1) && dimension.missingWeightPolicy.mode === "BLOCK")
      issues.push(`${dimension.name}: missing metric weight requires review`);
    if (!["BLOCK", "REDISTRIBUTE"].includes(dimension.missingWeightPolicy.mode))
      throw new Error("Unsupported missing-weight policy");
    const metrics = computed.map(
      ({ metric, observations, score }): VersionedMetricTrace => {
        const appliedWeight =
          score && availableWeight.gt(0)
            ? finite(metric.weight).div(availableWeight)
            : null;
        return {
          metricId: metric.metricId,
          metricName: metric.metricName,
          configuredWeight: metric.weight,
          appliedWeight: appliedWeight ? fixed(appliedWeight) : null,
          required: metric.required,
          periodAggregation: metric.periodAggregation,
          minimumObservations: metric.minimumObservations,
          observations,
          score: score ? fixed(score) : null,
          contribution:
            score && appliedWeight ? fixed(score.times(appliedWeight)) : null,
          proportionInterval:
            metric.measurementKind === "BINOMIAL_PROPORTION" &&
            metric.periodAggregation === "LATEST" &&
            observations.at(-1)?.numerator !== undefined &&
            observations.at(-1)?.denominator !== undefined
              ? wilson95(
                  observations.at(-1)!.numerator!,
                  observations.at(-1)!.denominator!,
                )
              : null,
        };
      },
    );
    const score = availableWeight.gt(0)
      ? computed
          .reduce(
            (sum, item) =>
              item.score ? sum.plus(item.score.times(item.metric.weight)) : sum,
            new Decimal(0),
          )
          .div(availableWeight)
      : null;
    const contribution = score?.times(dimension.weight) ?? null;
    if (contribution) total = total.plus(contribution);
    return {
      name: dimension.name,
      weight: dimension.weight,
      missingWeightPolicy: dimension.missingWeightPolicy,
      score: score ? fixed(score) : null,
      contribution: contribution ? fixed(contribution) : null,
      metrics,
    };
  });
  return {
    engineVersion: CURRENT_ENGINE_VERSION,
    inputSchemaVersion: CURRENT_INPUT_SCHEMA_VERSION,
    formulaVersion: input.formulaVersion,
    roundingPolicy: "HALF_UP_4DP_PER_OBSERVATION_AND_OUTPUT",
    status: issues.length ? "INCOMPLETE" : "COMPLETE",
    score: issues.length ? null : fixed(total),
    dimensions,
    issues,
  };
}

export function replayVersioned(
  input: VersionedEvaluationInput | Parameters<typeof calculate>[0],
) {
  if ("engineVersion" in input) {
    if (input.engineVersion !== CURRENT_ENGINE_VERSION)
      throw new Error("No executable implementation for stored engine version");
    return calculateV2(input);
  }
  return calculate(input);
}
