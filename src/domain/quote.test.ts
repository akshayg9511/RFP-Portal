import { describe, expect, it } from "vitest";
import {
  computeQuote,
  craftingCost,
  materialCost,
  missingInputs,
} from "./quote";

/**
 * The reference values are the ones the real vendors actually filled in.
 *
 *   Lauren Home Percale : rate 0.1 / efficiency 1 / SAM 21   -> 2.10
 *   Ponte (Radnik)      : hourly 5.4 / sewing SAM 38         -> 3.42
 *
 * If these drift, the form is computing something the vendor's own sheet
 * disagrees with — which is the one thing that cannot happen on stage.
 */

describe("crafting — the two formulas are genuinely different", () => {
  it("Percale: rate / efficiency * SAM", () => {
    const r = craftingCost(
      { directLaborRate: 0.1, lineEfficiency: 100, sam: 21 },
      "CPM_OVER_EFFICIENCY",
    );
    expect(r.core).toBeCloseTo(2.1, 5);
    expect(r.totalSam).toBe(21);
  });

  it("Percale: efficiency below 100% raises the cost", () => {
    const r = craftingCost(
      { directLaborRate: 0.1, lineEfficiency: 80, sam: 21 },
      "CPM_OVER_EFFICIENCY",
    );
    expect(r.core).toBeCloseTo(2.625, 5);
  });

  it("Ponte: hourly / 60 * total SAM, summed across three operations", () => {
    const r = craftingCost(
      { hourlyWage: 5.4, cuttingSam: 0, sewingSam: 38, finishingSam: 0 },
      "HOURLY_OVER_60",
    );
    expect(r.totalSam).toBe(38);
    expect(r.core).toBeCloseTo(3.42, 5);
  });

  it("Ponte sums all three SAM inputs", () => {
    const r = craftingCost(
      { hourlyWage: 6, cuttingSam: 5, sewingSam: 30, finishingSam: 5 },
      "HOURLY_OVER_60",
    );
    expect(r.totalSam).toBe(40);
    expect(r.core).toBeCloseTo(4, 5);
  });

  it("the same inputs give DIFFERENT answers under the two formulas", () => {
    // This is the whole reason the formulas are per-template.
    const values = {
      directLaborRate: 0.1,
      lineEfficiency: 100,
      sam: 21,
      hourlyWage: 0.1,
      sewingSam: 21,
    };
    const percale = craftingCost(values, "CPM_OVER_EFFICIENCY").core;
    const ponte = craftingCost(values, "HOURLY_OVER_60").core;
    expect(percale).not.toBeCloseTo(ponte, 3);
  });

  it("a zero efficiency does not divide by zero", () => {
    const r = craftingCost(
      { directLaborRate: 0.1, lineEfficiency: 0, sam: 21 },
      "CPM_OVER_EFFICIENCY",
    );
    expect(r.core).toBe(0);
  });

  it("adds wash, embellishing and other to the core", () => {
    const r = craftingCost(
      { hourlyWage: 6, sewingSam: 10, washCost: 0.5, otherCraftingCost: 0.25 },
      "HOURLY_OVER_60",
    );
    expect(r.core).toBeCloseTo(1, 5);
    expect(r.total).toBeCloseTo(1.75, 5);
  });
});

describe("material — also two formulas", () => {
  it("Percale: consumption * (grey + dye + print) * (1 + wastage)", () => {
    const r = materialCost(
      {
        consumption: 2,
        greyCostPerMeter: 1.5,
        dyeingCostPerMeter: 0.5,
        printingCostPerMeter: 0.25,
        wastage: 10,
      },
      "ADDITIVE_PER_METER",
    );
    // 2 * 2.25 * 1.1
    expect(r.core).toBeCloseTo(4.95, 5);
  });

  it("Ponte: consumption * cost/UoM * (1 + grading + production)", () => {
    const r = materialCost(
      {
        consumption: 1.5,
        costPerUom: 3,
        wastageGrading: 4,
        wastageProduction: 6,
      },
      "COST_PER_UOM",
    );
    // 1.5 * 3 * 1.10
    expect(r.core).toBeCloseTo(4.95, 5);
  });

  it("other materials add on top of the core", () => {
    const r = materialCost(
      { consumption: 1, costPerUom: 2, otherMaterialsCost: 0.5 },
      "COST_PER_UOM",
    );
    expect(r.core).toBeCloseTo(2, 5);
    expect(r.total).toBeCloseTo(2.5, 5);
  });
});

describe("computeQuote", () => {
  const spec = {
    craftingFormula: "CPM_OVER_EFFICIENCY" as const,
    materialFormula: "ADDITIVE_PER_METER" as const,
    trimKeys: ["sewingThread", "buttons"],
    packagingKeys: ["polyBag", "cartonBox"],
  };

  const values = {
    consumption: 2,
    greyCostPerMeter: 1.5,
    wastage: 10,
    sewingThread: 0.1,
    buttons: 0.2,
    polyBag: 0.05,
    cartonBox: 0.15,
    directLaborRate: 0.1,
    lineEfficiency: 100,
    sam: 21,
    overheadCost: 1.62,
  };

  it("FOB is the sum of the five buckets — the identity both templates share", () => {
    const r = computeQuote(values, spec);
    const sum =
      r.buckets.BASE_MATERIALS +
      r.buckets.TRIM_HARDWARE +
      r.buckets.PACKAGING +
      r.buckets.CRAFTING +
      r.buckets.OVERHEAD_SGA_PROFIT;
    expect(r.fob).toBeCloseTo(sum, 10);
    // 3.30 + 0.30 + 0.20 + 2.10 + 1.62
    expect(r.fob).toBeCloseTo(7.52, 5);
  });

  it("derives the overhead percentage against cost before overhead", () => {
    const r = computeQuote(values, spec);
    expect(r.overheadPercent).toBeCloseTo(1.62 / 5.9, 4);
  });

  it("an empty quote is zero everywhere rather than NaN", () => {
    const r = computeQuote({}, spec);
    expect(r.fob).toBe(0);
    expect(r.overheadPercent).toBe(0);
    expect(Number.isNaN(r.fob)).toBe(false);
  });

  it("treats a typed string as the number it is", () => {
    // Inputs arrive from the DOM as strings.
    const r = computeQuote({ ...values, overheadCost: "1.62" }, spec);
    expect(r.fob).toBeCloseTo(7.52, 5);
  });

  it("ignores junk rather than propagating NaN", () => {
    const r = computeQuote({ ...values, overheadCost: "abc" }, spec);
    expect(r.fob).toBeCloseTo(5.9, 5);
  });

  it("sums only the trim keys the template declares", () => {
    const r = computeQuote({ ...values, notATrimLine: 99 }, spec);
    expect(r.buckets.TRIM_HARDWARE).toBeCloseTo(0.3, 5);
  });
});

describe("missingInputs", () => {
  it("names what a Percale quote still needs", () => {
    const missing = missingInputs(
      {},
      {
        craftingFormula: "CPM_OVER_EFFICIENCY",
        materialFormula: "ADDITIVE_PER_METER",
      },
    );
    expect(missing).toContain("consumption");
    expect(missing).toContain("lineEfficiency");
    expect(missing).toContain("overheadCost");
  });

  it("accepts any one of Ponte's three SAM inputs", () => {
    const missing = missingInputs(
      { hourlyWage: 5, cuttingSam: 4, overheadCost: 1, consumption: 1, costPerUom: 1 },
      { craftingFormula: "HOURLY_OVER_60", materialFormula: "COST_PER_UOM" },
    );
    expect(missing).toHaveLength(0);
  });

  it("is empty once a Percale quote is complete", () => {
    const missing = missingInputs(
      {
        consumption: 2,
        greyCostPerMeter: 1.5,
        directLaborRate: 0.1,
        lineEfficiency: 100,
        sam: 21,
        overheadCost: 1.62,
      },
      {
        craftingFormula: "CPM_OVER_EFFICIENCY",
        materialFormula: "ADDITIVE_PER_METER",
      },
    );
    expect(missing).toHaveLength(0);
  });
});

describe("negative inputs", () => {
  it("floors a negative cost to zero rather than reducing the FOB", () => {
    const spec = {
      craftingFormula: "HOURLY_OVER_60" as const,
      materialFormula: "COST_PER_UOM" as const,
      trimKeys: ["zipper"],
      packagingKeys: [],
    };
    const honest = computeQuote(
      { consumption: 1, costPerUom: 5, zipper: 0, overheadCost: 1 },
      spec,
    );
    const cheating = computeQuote(
      { consumption: 1, costPerUom: 5, zipper: -3, overheadCost: 1 },
      spec,
    );
    expect(cheating.fob).toBe(honest.fob);
  });
});
