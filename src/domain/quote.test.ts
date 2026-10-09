import { describe, expect, it } from "vitest";
import {
  computeQuote,
  craftingCost,
  materialCost,
  missingInputs,
  reconcileToBuckets,
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

/* ─────────────────────────────────────────────────────────────────────────────
   J1 — the light template: a typed bucket total overrides the derived one.

   This is the regression guard for the defect Akshay found on 4 Oct: the
   initial quote had NO editable field for Materials or Crafting, because
   both are always derived and `totalMaterialCost` is itself a derived line.
   ──────────────────────────────────────────────────────────────────────────── */

describe("typed bucket totals (the light template)", () => {
  const spec = {
    craftingFormula: "CPM_OVER_EFFICIENCY" as const,
    materialFormula: "ADDITIVE_PER_METER" as const,
    trimKeys: ["sewingThread", "buttons"],
    packagingKeys: ["polyBag", "cartonBox"],
  };

  it("accepts five typed totals and sums them to FOB", () => {
    // The whole of round one: six numbers, no line items at all.
    const r = computeQuote(
      {
        totalMaterialCost: 4.16,
        totalTrimCost: 0.9,
        totalPackagingCost: 0.3,
        totalCraftingCost: 3.42,
        overheadCost: 0.4,
      },
      spec,
    );

    expect(r.buckets.BASE_MATERIALS).toBeCloseTo(4.16, 4);
    expect(r.buckets.TRIM_HARDWARE).toBeCloseTo(0.9, 4);
    expect(r.buckets.PACKAGING).toBeCloseTo(0.3, 4);
    expect(r.buckets.CRAFTING).toBeCloseTo(3.42, 4);
    expect(r.buckets.OVERHEAD_SGA_PROFIT).toBeCloseTo(0.4, 4);
    // The identity both real templates share still holds.
    expect(r.fob).toBeCloseTo(9.18, 4);
  });

  it("reports which buckets are typed rather than derived", () => {
    const r = computeQuote(
      { totalMaterialCost: 4.16, totalCraftingCost: 3.42 },
      spec,
    );
    expect(r.overriddenBuckets).toContain("BASE_MATERIALS");
    expect(r.overriddenBuckets).toContain("CRAFTING");
  });

  it("LETS THE LINE ITEMS WIN once they produce a value", () => {
    // The precedence rule that will otherwise bite: a vendor types a total on
    // round one, then fills the detail on round two. The detail is the more
    // specific statement, so it takes over — and the form must say so rather
    // than silently replacing a number the vendor typed.
    const typedOnly = computeQuote({ totalMaterialCost: 99 }, spec);
    expect(typedOnly.buckets.BASE_MATERIALS).toBeCloseTo(99, 4);

    const withDetail = computeQuote(
      {
        totalMaterialCost: 99,
        consumption: 2,
        greyCostPerMeter: 1.5,
        wastage: 0,
      },
      spec,
    );
    expect(withDetail.buckets.BASE_MATERIALS).toBeCloseTo(3, 4);
    expect(withDetail.overriddenBuckets).not.toContain("BASE_MATERIALS");
  });

  it("ignores a blank or non-numeric typed total", () => {
    const r = computeQuote(
      { totalMaterialCost: "", totalCraftingCost: "   " },
      spec,
    );
    // `Number("   ")` is 0, not NaN — the trap that bit the terms mapper in
    // P1b. A whitespace-only field must not become a zero-cost bucket.
    expect(r.buckets.BASE_MATERIALS).toBe(0);
    expect(r.overriddenBuckets).toHaveLength(0);
  });

  it("never lets a typed zero mask real line items", () => {
    const r = computeQuote(
      { totalMaterialCost: 0, consumption: 2, greyCostPerMeter: 1.5, wastage: 0 },
      spec,
    );
    expect(r.buckets.BASE_MATERIALS).toBeCloseTo(3, 4);
  });
});

describe("the submit gate knows which template it is asking for", () => {
  const spec = {
    craftingFormula: "CPM_OVER_EFFICIENCY" as const,
    materialFormula: "ADDITIVE_PER_METER" as const,
  };

  it("LETS A LIGHT QUOTE SUBMIT on its five totals alone", () => {
    // The regression this guards: J1 made the totals enterable but left the
    // gate demanding the line items, so a vendor could fill the light
    // template completely, watch FOB compute, and still find Submit
    // disabled with no reason given.
    const light = missingInputs(
      {
        totalMaterialCost: 4.16,
        totalTrimCost: 0.9,
        totalPackagingCost: 0.3,
        totalCraftingCost: 3.42,
        overheadCost: 0.4,
      },
      { ...spec, template: "LIGHT" },
    );
    expect(light).toEqual([]);
  });

  it("still blocks a light quote with a bucket left blank, and names it", () => {
    const light = missingInputs(
      { totalMaterialCost: 4.16, overheadCost: 0.4 },
      { ...spec, template: "LIGHT" },
    );
    expect(light).toEqual(["trim", "packaging", "crafting"]);
  });

  it("accepts line items in place of a typed total at LIGHT", () => {
    // A vendor who filled the detail early must not also be asked for the
    // total — the bucket has a value either way.
    const light = missingInputs(
      {
        consumption: 2,
        greyCostPerMeter: 1.5,
        directLaborRate: 10,
        lineEfficiency: 0.8,
        sam: 20,
        totalTrimCost: 0.9,
        totalPackagingCost: 0.3,
        overheadCost: 0.4,
      },
      { ...spec, template: "LIGHT" },
    );
    expect(light).toEqual([]);
  });

  it("STILL demands the line items at FULL", () => {
    // The full template is the whole point of the later stages; bucket
    // totals must not satisfy it.
    const full = missingInputs(
      {
        totalMaterialCost: 4.16,
        totalTrimCost: 0.9,
        totalPackagingCost: 0.3,
        totalCraftingCost: 3.42,
        overheadCost: 0.4,
      },
      { ...spec, template: "FULL" },
    );
    expect(full).toContain("consumption");
    expect(full).toContain("directLaborRate");
  });

  it("defaults to FULL when no template is given", () => {
    // Every pre-existing caller must keep its behaviour.
    const a = missingInputs({}, spec);
    const b = missingInputs({}, { ...spec, template: "FULL" });
    expect(a).toEqual(b);
  });
});

describe("reconcileToBuckets", () => {
  const spec = {
    craftingFormula: "CPM_OVER_EFFICIENCY" as const,
    materialFormula: "ADDITIVE_PER_METER" as const,
    trimKeys: ["sewingThread", "buttons"],
    packagingKeys: ["polyBag", "cartonBox"],
  };
  const values = {
    consumption: 5.38, greyCostPerMeter: 1.7066, dyeingCostPerMeter: 0.7707, printingCostPerMeter: 0.2754,
    wastage: 7.8, otherMaterialsCost: 0.56, sam: 3.3, directLaborRate: 0.138, lineEfficiency: 92,
    otherCraftingCost: 0.02, sewingThread: 0.0109, buttons: 0.014, polyBag: 0.1793, cartonBox: 0.0751,
    overheadCost: 1.3445,
  };
  const target = { BASE_MATERIALS: 12.5442, TRIM_HARDWARE: 0.0658, PACKAGING: 0.4477, CRAFTING: 0.3909, OVERHEAD_SGA_PROFIT: 1.0206 };

  it("makes every bucket's lines add up to its total", () => {
    const r = computeQuote(reconcileToBuckets(values, spec, target), spec);
    for (const [k, v] of Object.entries(target)) {
      expect(r.buckets[k as keyof typeof r.buckets]).toBeCloseTo(v, 2);
    }
  });
});
