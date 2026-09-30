import { describe, expect, it } from "vitest";
import { wilson95 } from "./proportion.ts";

describe("binary proportion uncertainty", () => {
  it("shows different evidence strength for the same perfect observed percentage", () => {
    const small = wilson95("3", "3");
    const large = wilson95("3000", "3000");
    expect(small.observedPercent).toBe("100.0000");
    expect(large.observedPercent).toBe("100.0000");
    expect(Number(small.lowerPercent)).toBeLessThan(50);
    expect(Number(large.lowerPercent)).toBeGreaterThan(99);
    expect(small.upperPercent).toBe("100.0000");
  });

  it("computes a bounded interval at both ends and in the interior", () => {
    expect(wilson95("0", "10")).toMatchObject({
      lowerPercent: "0.0000",
      observedPercent: "0.0000",
    });
    const middle = wilson95("50", "100");
    expect(Number(middle.lowerPercent)).toBeGreaterThan(40);
    expect(Number(middle.upperPercent)).toBeLessThan(60);
  });

  it("rejects impossible and fractional counts", () => {
    for (const [x, n] of [
      ["4", "3"],
      ["1.5", "3"],
      ["0", "0"],
      ["-1", "3"],
    ])
      expect(() => wilson95(x!, n!)).toThrow("requires integer");
  });
});
