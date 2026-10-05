import { describe, expect, it } from "vitest";
import {
  allocate,
  allocateGrouped,
  savingsPotential,
  scenarios,
  styleStatus,
  weightedBaseline,
} from "./award";

const vendor = (
  id: string,
  pct: number,
  bestCost: number,
  extra: Partial<Parameters<typeof allocate>[0]["vendors"][number]> = {},
) => ({
  vendorId: id,
  vendorName: id,
  cooRegion: "CHINA",
  awardPct: pct,
  bestCost,
  bestCostBasis: "QUINCE_BLEND" as const,
  isNewToQuince: false,
  ...extra,
});

describe("the 100% validation", () => {
  // The one hard rule in the product, never overridable. This is what the
  // Wave 1 workbook lacked when 32 styles were awarded at 500%.
  const style = {
    styleId: "s1",
    planUnits: 1000,
    baselineLanded: 10,
    vendors: [] as ReturnType<typeof vendor>[],
  };

  it("accepts exactly 100", () => {
    const r = allocate({
      ...style,
      vendors: [vendor("a", 60, 8), vendor("b", 40, 9)],
    });
    expect(r.allocatedPct).toBe(100);
    expect(r.remainingPct).toBe(0);
    expect(r.isValid).toBe(true);
  });

  it("rejects under 100", () => {
    const r = allocate({ ...style, vendors: [vendor("a", 78, 8)] });
    expect(r.isValid).toBe(false);
    expect(r.remainingPct).toBe(22);
  });

  it("rejects over 100 — the 500% bug", () => {
    const r = allocate({
      ...style,
      vendors: [
        vendor("a", 100, 8),
        vendor("b", 100, 9),
        vendor("c", 100, 9),
        vendor("d", 100, 9),
        vendor("e", 100, 9),
      ],
    });
    expect(r.allocatedPct).toBe(500);
    expect(r.isValid).toBe(false);
  });

  it("tolerates float dust but not a real gap", () => {
    expect(
      allocate({
        ...style,
        vendors: [vendor("a", 33.33, 8), vendor("b", 33.33, 8), vendor("c", 33.34, 8)],
      }).isValid,
    ).toBe(true);
    expect(
      allocate({ ...style, vendors: [vendor("a", 99.5, 8)] }).isValid,
    ).toBe(false);
  });
});

describe("allocation arithmetic", () => {
  const style = {
    styleId: "s1",
    planUnits: 10_000,
    baselineLanded: 12,
    vendors: [vendor("a", 60, 9), vendor("b", 40, 10)],
  };

  it("computes units, dollars and savings per vendor", () => {
    const r = allocate(style);
    expect(r.lines[0].awardedUnits).toBe(6000);
    expect(r.lines[0].awardedDollars).toBe(54_000);
    // Savings measured against baseline FOB, never baseline landed.
    expect(r.lines[0].savingsDollars).toBe(6000 * (12 - 9));
  });

  it("totals across vendors", () => {
    const r = allocate(style);
    expect(r.totalAwardedDollars).toBe(54_000 + 40_000);
    expect(r.totalSavingsDollars).toBe(18_000 + 8_000);
  });

  it("blends cost by share, and reports savings percent", () => {
    const r = allocate(style);
    expect(r.blendedCost).toBeCloseTo(9.4, 5);
    expect(r.savingsPercent).toBeCloseTo(26_000 / 120_000, 5);
  });

  it("handles a single-vendor award", () => {
    const r = allocate({ ...style, vendors: [vendor("a", 100, 9)] });
    expect(r.isValid).toBe(true);
    expect(r.blendedCost).toBe(9);
  });
});

describe("savingsPotential", () => {
  it("uses the lowest Best Cost at 100%", () => {
    expect(savingsPotential(1000, 10, [8, 9, 9.5])).toBe(2000);
  });

  it("is zero with no bids", () => {
    expect(savingsPotential(1000, 10, [])).toBe(0);
  });
});

describe("scenarios", () => {
  const bids = [
    { bestCost: 8.0, isNewToQuince: false, isCurrentSupplier: true },
    { bestCost: 8.5, isNewToQuince: true, isCurrentSupplier: false },
    { bestCost: 9.0, isNewToQuince: false, isCurrentSupplier: false },
    { bestCost: 9.5, isNewToQuince: true, isCurrentSupplier: false },
  ];

  it("1 — averages up to the three lowest", () => {
    expect(scenarios(bids).bestCost).toBeCloseTo((8 + 8.5 + 9) / 3, 5);
  });

  it("2 — averages vendors inside the ecosystem", () => {
    expect(scenarios(bids).incumbent).toBeCloseTo(8.5, 5);
  });

  it("3 — blends best current supplier with best new at the configured ratio", () => {
    expect(scenarios(bids).ratio).toBeCloseTo(8 * 0.7 + 8.5 * 0.3, 5);
  });

  it("honours a reconfigured ratio", () => {
    const r = scenarios(bids, { incumbent: 0.5, new: 0.5 });
    expect(r.ratio).toBeCloseTo(8.25, 5);
  });

  it("returns null where the pool cannot support a scenario", () => {
    // No new vendor at all — scenario 3 cannot be computed, and must not be
    // faked. Wave 1 had a single vendor type on 27% of styles.
    const onlyExisting = [
      { bestCost: 8, isNewToQuince: false, isCurrentSupplier: true },
    ];
    expect(scenarios(onlyExisting).ratio).toBeNull();
    expect(scenarios([]).bestCost).toBeNull();
  });
});

describe("styleStatus", () => {
  it("walks the status flow", () => {
    expect(styleStatus([])).toBe("UNTOUCHED");
    expect(styleStatus([{ awardPct: 100 }])).toBe("ALLOCATED");
    expect(
      styleStatus([{ awardPct: 100, status: "READY_FOR_REVIEW" }]),
    ).toBe("READY_FOR_REVIEW");
    expect(styleStatus([{ awardPct: 100, status: "AWARDED" }])).toBe("AWARDED");
  });
});

describe("landed against landed — the sign regression", () => {
  /**
   * This bug has now appeared twice: once as -$8.29M on Wave Insights, once as
   * a negative savings potential on every row of Award Summary. Both times the
   * cause was a LANDED Best Cost measured against an FOB baseline.
   *
   * Realistic magnitudes: baseline FOB 21.98, baseline landed 37.25, and a
   * genuinely competitive landed bid at 30.50. Against the landed baseline
   * that is a real saving; against FOB it reads as a large increase.
   */
  const planUnits = 260_051;
  const baselineFob = 21.98;
  const baselineLanded = 37.25;
  const competitiveLandedBid = 30.5;

  it("a competitive bid shows a POSITIVE saving against the landed baseline", () => {
    const result = savingsPotential(planUnits, baselineLanded, [
      competitiveLandedBid,
    ]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(planUnits * (37.25 - 30.5), 2);
  });

  it("the same bid against an FOB baseline inverts the sign — the defect", () => {
    // Not an endorsement: this asserts the failure mode so the contrast is on
    // the record. Award Summary must never pass baselineFob here.
    expect(
      savingsPotential(planUnits, baselineFob, [competitiveLandedBid]),
    ).toBeLessThan(0);
  });

  it("allocate agrees with savingsPotential at 100% to one vendor", () => {
    const result = allocate({
      styleId: "s1",
      planUnits,
      baselineLanded,
      vendors: [
        {
          vendorId: "v1",
          vendorName: "Yantai North",
          cooRegion: "CHINA",
          awardPct: 100,
          bestCost: competitiveLandedBid,
          bestCostBasis: "QUINCE_BLEND",
          isNewToQuince: false,
        },
      ],
    });

    expect(result.totalSavingsDollars).toBeCloseTo(
      savingsPotential(planUnits, baselineLanded, [competitiveLandedBid]),
      2,
    );
    expect(result.savingsPercent).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   Variation-level awarding (N1 / N3).
   ──────────────────────────────────────────────────────────────────────────── */

const gv = (id: string, pct: number, cost: number) => ({
  vendorId: id,
  vendorName: id,
  cooRegion: "ISC",
  awardPct: pct,
  bestCost: cost,
  bestCostBasis: "QUINCE_BLEND" as const,
  isNewToQuince: false,
});

describe("allocateGrouped — 100% per variation", () => {
  it("is valid only when EVERY variation is exactly 100", () => {
    const r = allocateGrouped([
      { styleId: "s", variationId: "q", label: "Queen", planUnits: 100, baselineLanded: 10, vendors: [gv("A", 60, 9), gv("B", 40, 9.5)] },
      { styleId: "s", variationId: "k", label: "King", planUnits: 80, baselineLanded: 11, vendors: [gv("A", 100, 10)] },
    ]);
    expect(r.isValid).toBe(true);
    expect(r.invalid).toEqual([]);
  });

  it("refuses the whole save when ONE variation is at 99, and names it", () => {
    const r = allocateGrouped([
      { styleId: "s", variationId: "q", label: "Queen", planUnits: 100, baselineLanded: 10, vendors: [gv("A", 100, 9)] },
      { styleId: "s", variationId: "k", label: "King", planUnits: 80, baselineLanded: 11, vendors: [gv("A", 99, 10)] },
    ]);
    expect(r.isValid).toBe(false);
    expect(r.invalid).toEqual(["King"]);
  });

  it("accepts 5 sizes x 100% — it is NOT 500%", () => {
    // The Wave 1 bug in reverse: checking 100% at style scope would reject
    // five correctly-allocated sizes as 500%.
    const sizes = ["Twin", "Full", "Queen", "King", "Cal King"];
    const r = allocateGrouped(
      sizes.map((s) => ({
        styleId: "s", variationId: s, label: s, planUnits: 50, baselineLanded: 10,
        vendors: [gv("A", 100, 9)],
      })),
    );
    expect(r.isValid).toBe(true);
  });

  it("treats a STYLE-grained product as one group, identical to allocate()", () => {
    const style = { styleId: "s", planUnits: 100, baselineLanded: 10, vendors: [gv("A", 70, 9), gv("B", 30, 9.5)] };
    const grouped = allocateGrouped([{ ...style, variationId: null, label: "All" }]);
    const single = allocate(style);
    expect(grouped.totalAwardedDollars).toBeCloseTo(single.totalAwardedDollars, 6);
    expect(grouped.totalSavingsDollars).toBeCloseTo(single.totalSavingsDollars, 6);
    expect(grouped.blendedCost).toBeCloseTo(single.blendedCost, 6);
  });

  it("weights blended cost by units, not as a mean of means", () => {
    const r = allocateGrouped([
      { styleId: "s", variationId: "q", label: "Queen", planUnits: 900, baselineLanded: 10, vendors: [gv("A", 100, 10)] },
      { styleId: "s", variationId: "c", label: "Cal King", planUnits: 100, baselineLanded: 20, vendors: [gv("A", 100, 20)] },
    ]);
    // Mean of means would be 15. Weighted: (10*900 + 20*100)/1000 = 11.
    expect(r.blendedCost).toBeCloseTo(11, 6);
  });
});

describe("weightedBaseline", () => {
  it("is volume-weighted and differs from a plain mean on skewed volume", () => {
    const v = [
      { baseline: 10, planUnits: 900 },
      { baseline: 20, planUnits: 100 },
    ];
    expect(weightedBaseline(v)).toBeCloseTo(11, 6);
    expect(weightedBaseline(v)).not.toBeCloseTo(15, 1);
  });

  it("returns 0 rather than NaN with no volume", () => {
    expect(weightedBaseline([])).toBe(0);
  });
});
