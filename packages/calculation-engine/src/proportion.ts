import { Decimal } from "decimal.js";

export type ProportionInterval = Readonly<{
  method: "WILSON_95";
  numerator: string;
  denominator: string;
  observedPercent: string;
  lowerPercent: string;
  upperPercent: string;
}>;

/** Wilson score interval for independent binary trials; descriptive evidence only. */
export function wilson95(
  numerator: string,
  denominator: string,
): ProportionInterval {
  const x = new Decimal(numerator);
  const n = new Decimal(denominator);
  if (
    !x.isFinite() ||
    !n.isFinite() ||
    !x.isInteger() ||
    !n.isInteger() ||
    x.lt(0) ||
    n.lte(0) ||
    x.gt(n)
  )
    throw new Error(
      "A proportion requires integer 0 <= numerator <= denominator",
    );
  const z = new Decimal("1.959963984540054");
  const z2 = z.pow(2);
  const p = x.div(n);
  const divisor = new Decimal(1).plus(z2.div(n));
  const center = p.plus(z2.div(n.mul(2))).div(divisor);
  const halfWidth = z
    .mul(
      p
        .mul(new Decimal(1).minus(p))
        .div(n)
        .plus(z2.div(n.pow(2).mul(4)))
        .sqrt(),
    )
    .div(divisor);
  const percent = (value: Decimal) =>
    value.mul(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  return {
    method: "WILSON_95",
    numerator: x.toFixed(0),
    denominator: n.toFixed(0),
    observedPercent: percent(p),
    lowerPercent: percent(Decimal.max(0, center.minus(halfWidth))),
    upperPercent: percent(Decimal.min(1, center.plus(halfWidth))),
  };
}
