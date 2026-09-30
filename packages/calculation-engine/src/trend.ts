import { Decimal } from "decimal.js";

export type TrendPoint = Readonly<{
  evaluationId: string;
  startsOn: string;
  endsOn: string;
  score: string;
}>;

export type TrendResult = Readonly<{
  status: "AVAILABLE" | "INSUFFICIENT";
  reason: string | null;
  minimumObservations: 3;
  points: readonly TrendPoint[];
  mean: string | null;
  sampleVolatility: string | null;
  slopePerYear: string | null;
  firstToLastChange: string | null;
}>;

function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Trend dates must be ISO calendar dates");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  )
    throw new Error("Trend dates must be valid calendar dates");
  return time / 86400000;
}

function fixed(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function insufficient(
  points: readonly TrendPoint[],
  reason: string,
): TrendResult {
  return {
    status: "INSUFFICIENT",
    reason,
    minimumObservations: 3,
    points,
    mean: null,
    sampleVolatility: null,
    slopePerYear: null,
    firstToLastChange: null,
  };
}

/** Descriptive trend for one stable role template and one review purpose. No causal or predictive interpretation. */
export function describeTrend(input: readonly TrendPoint[]): TrendResult {
  const points = [...input].sort((a, b) => a.endsOn.localeCompare(b.endsOn));
  if (points.length < 3)
    return insufficient(
      points,
      "At least three published observations are required",
    );
  const dates = points.map((point) => ({
    start: day(point.startsOn),
    end: day(point.endsOn),
  }));
  const scores = points.map((point) => new Decimal(point.score));
  if (scores.some((score) => !score.isFinite() || score.lt(0)))
    throw new Error("Trend scores must be finite nonnegative numbers");
  if (dates.some((period) => period.end < period.start))
    throw new Error("Trend cycle end cannot precede its start");
  if (
    dates.some(
      (period, index) => index > 0 && period.start <= dates[index - 1]!.end,
    )
  )
    return insufficient(
      points,
      "Overlapping review cycles cannot form a trend",
    );
  const lengths = dates.map((period) => period.end - period.start + 1);
  if (Math.max(...lengths) / Math.min(...lengths) > 1.25)
    return insufficient(points, "Review-cycle lengths differ by more than 25%");
  const n = new Decimal(points.length);
  const mean = scores
    .reduce((sum, score) => sum.plus(score), new Decimal(0))
    .div(n);
  const variance = scores
    .reduce((sum, score) => sum.plus(score.minus(mean).pow(2)), new Decimal(0))
    .div(n.minus(1));
  const xs = dates.map((period) => new Decimal(period.end - dates[0]!.end));
  const meanX = xs
    .reduce((sum, value) => sum.plus(value), new Decimal(0))
    .div(n);
  const xVariance = xs.reduce(
    (sum, value) => sum.plus(value.minus(meanX).pow(2)),
    new Decimal(0),
  );
  if (xVariance.isZero())
    return insufficient(points, "Review cycles need distinct end dates");
  const covariance = xs.reduce(
    (sum, value, index) =>
      sum.plus(value.minus(meanX).mul(scores[index]!.minus(mean))),
    new Decimal(0),
  );
  return {
    status: "AVAILABLE",
    reason: null,
    minimumObservations: 3,
    points,
    mean: fixed(mean),
    sampleVolatility: fixed(variance.sqrt()),
    slopePerYear: fixed(covariance.div(xVariance).mul("365.25")),
    firstToLastChange: fixed(scores.at(-1)!.minus(scores[0]!)),
  };
}
