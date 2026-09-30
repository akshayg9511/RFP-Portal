import { describe, expect, it } from "vitest";
import {
  strategies,
  regionSplit,
  REGION_ORDER,
  splitMatches,
  splitFromInputs,
  splitTotalsHundred,
} from "./strategies";
import type { StrategyBid } from "./strategies";
import { allocate } from "./award";

/**
 * A strategy's ONLY job is to propose percentages that total exactly 100.
 * `PUT /api/styles/[id]/award` rejects anything else, so a strategy that
 * proposes 99.99 is a strategy the buyer cannot save.
 */

function bid(over: Partial<StrategyBid> & { vendorId: string }): StrategyBid {
  return {
    bestCost: 10,
    cooRegion: "ISC",
    isNewToQuince: false,
    isCurrentSupplier: false,
    ...over,
  };
}

const total = (split: Record<string, number>) =>
  Object.values(split).reduce((s, v) => s + v, 0);

describe("strategies — the 100% invariant", () => {
  it("every available strategy totals exactly 100", () => {
    const bids = [
      bid({ vendorId: "a", bestCost: 8, cooRegion: "CHINA", isCurrentSupplier: true }),
      bid({ vendorId: "b", bestCost: 9, cooRegion: "ISC" }),
      bid({ vendorId: "c", bestCost: 10, cooRegion: "SEA", isNewToQuince: true }),
      bid({ vendorId: "d", bestCost: 11, cooRegion: "AMERICAS" }),
    ];
    const built = strategies(bids).filter((s) => !s.unavailable);
    expect(built.length).toBe(4);
    for (const s of built) {
      expect(total(s.split), `${s.key} must total 100`).toBe(100);
    }
  });

  /**
   * The case that motivated the test: 100/3 is irrational, so a naive even
   * split gives 33.33 x 3 = 99.99 and the save is refused.
   */
  it("a three-way even split totals 100, not 99.99", () => {
    const bids = [
      bid({ vendorId: "a", bestCost: 8 }),
      bid({ vendorId: "b", bestCost: 9 }),
      bid({ vendorId: "c", bestCost: 10 }),
    ];
    const s = strategies(bids).find((x) => x.key === "THREE_LOWEST_EXISTING")!;
    expect(total(s.split)).toBe(100);
    // The remainder lands on the CHEAPEST vendor, which is the split a buyer
    // would make by hand.
    expect(s.split.a).toBe(34);
    expect(s.split.b).toBe(33);
    expect(s.split.c).toBe(33);
  });

  it("holds for 6 and 7 vendors, where the remainder is larger", () => {
    for (const n of [6, 7]) {
      const bids = Array.from({ length: n }, (_, i) =>
        bid({ vendorId: `v${i}`, bestCost: 10 + i, cooRegion: "SEA" }),
      );
      const s = strategies(bids).find((x) => x.key === "EQUAL_NON_CHINA")!;
      expect(total(s.split), `${n} vendors`).toBe(100);
    }
  });

  it("proposals survive allocate() as valid", () => {
    const bids = [
      bid({ vendorId: "a", bestCost: 8 }),
      bid({ vendorId: "b", bestCost: 9 }),
      bid({ vendorId: "c", bestCost: 10 }),
    ];
    for (const s of strategies(bids).filter((x) => !x.unavailable)) {
      const result = allocate({
        styleId: "s1",
        planUnits: 100_000,
        baselineLanded: 12,
        vendors: bids.map((b) => ({
          vendorId: b.vendorId,
          vendorName: b.vendorId,
          cooRegion: b.cooRegion,
          awardPct: s.split[b.vendorId] ?? 0,
          bestCost: b.bestCost,
          bestCostBasis: "QUINCE_BLEND" as const,
          isNewToQuince: b.isNewToQuince,
        })),
      });
      expect(result.isValid, `${s.key} must be saveable`).toBe(true);
    }
  });
});

describe("strategies — who is eligible", () => {
  it("never proposes a vendor that is not in the bid list", () => {
    const bids = [bid({ vendorId: "a" }), bid({ vendorId: "b" })];
    const ids = new Set(["a", "b"]);
    for (const s of strategies(bids)) {
      for (const vendorId of Object.keys(s.split)) {
        expect(ids.has(vendorId), `${s.key} proposed ${vendorId}`).toBe(true);
      }
    }
  });

  it("3-lowest-existing excludes vendors new to Quince", () => {
    const bids = [
      bid({ vendorId: "new1", bestCost: 5, isNewToQuince: true }),
      bid({ vendorId: "old1", bestCost: 9 }),
      bid({ vendorId: "old2", bestCost: 10 }),
    ];
    const s = strategies(bids).find((x) => x.key === "THREE_LOWEST_EXISTING")!;
    expect(Object.keys(s.split).sort()).toEqual(["old1", "old2"]);
    // Degrades to two rather than becoming unavailable.
    expect(s.unavailable).toBeNull();
    expect(total(s.split)).toBe(100);
  });

  it("3-lowest-existing takes the three CHEAPEST, not the first three", () => {
    const bids = [
      bid({ vendorId: "dear", bestCost: 20 }),
      bid({ vendorId: "mid", bestCost: 10 }),
      bid({ vendorId: "cheap", bestCost: 5 }),
      bid({ vendorId: "cheaper", bestCost: 6 }),
    ];
    const s = strategies(bids).find((x) => x.key === "THREE_LOWEST_EXISTING")!;
    expect(Object.keys(s.split).sort()).toEqual(["cheap", "cheaper", "mid"]);
  });

  it("non-China takes EVERY non-China bidder, not the cheapest few", () => {
    const bids = [
      bid({ vendorId: "cn", bestCost: 5, cooRegion: "CHINA" }),
      bid({ vendorId: "isc", bestCost: 9, cooRegion: "ISC" }),
      bid({ vendorId: "sea", bestCost: 10, cooRegion: "SEA" }),
      bid({ vendorId: "emea", bestCost: 30, cooRegion: "EMEA" }),
    ];
    const s = strategies(bids).find((x) => x.key === "EQUAL_NON_CHINA")!;
    // The expensive EMEA vendor is included: the question is what happens if
    // China is off the table, and dropping it would understate the cost.
    expect(Object.keys(s.split).sort()).toEqual(["emea", "isc", "sea"]);
    expect(s.split.cn).toBeUndefined();
  });

  /** Unknown region treated as non-China would OVERSTATE the de-risk. */
  it("non-China excludes a vendor with no declared region", () => {
    const bids = [
      bid({ vendorId: "known", cooRegion: "ISC" }),
      bid({ vendorId: "unknown", cooRegion: null }),
    ];
    const s = strategies(bids).find((x) => x.key === "EQUAL_NON_CHINA")!;
    expect(s.split).toEqual({ known: 100 });
  });

  it("the ratio rule needs both sides, and says which is missing", () => {
    const noNew = strategies([
      bid({ vendorId: "a", isCurrentSupplier: true }),
    ]).find((x) => x.key === "INCUMBENT_NEW_RATIO")!;
    expect(noNew.unavailable).toMatch(/no new vendor/i);

    const noIncumbent = strategies([
      bid({ vendorId: "b", isNewToQuince: true }),
    ]).find((x) => x.key === "INCUMBENT_NEW_RATIO")!;
    expect(noIncumbent.unavailable).toMatch(/no current supplier/i);
  });

  it("the ratio rule honours a configured ratio and still totals 100", () => {
    const bids = [
      bid({ vendorId: "inc", bestCost: 9, isCurrentSupplier: true }),
      bid({ vendorId: "new", bestCost: 8, isNewToQuince: true }),
    ];
    const s = strategies(bids, { incumbent: 0.6, new: 0.4 }).find(
      (x) => x.key === "INCUMBENT_NEW_RATIO",
    )!;
    expect(s.split).toEqual({ new: 40, inc: 60 });
    expect(s.label).toContain("60/40");
    expect(total(s.split)).toBe(100);
  });

  it("no bids at all leaves every strategy unavailable with a reason", () => {
    const all = strategies([]);
    expect(all).toHaveLength(4);
    for (const s of all) {
      expect(s.unavailable, s.key).toBeTruthy();
      expect(s.split).toEqual({});
    }
  });

  it("order is stable even when strategies are unavailable", () => {
    const keys = strategies([bid({ vendorId: "a" })]).map((s) => s.key);
    expect(keys).toEqual([
      "LOWEST",
      "THREE_LOWEST_EXISTING",
      "EQUAL_NON_CHINA",
      "INCUMBENT_NEW_RATIO",
    ]);
  });
});

describe("regionSplit — informational, all five regions", () => {
  it("always returns the five regions in a fixed order", () => {
    const rows = regionSplit([], []);
    expect(rows.map((r) => r.region)).toEqual(REGION_ORDER);
  });

  it("shares sum to 1 across allocated value", () => {
    const rows = regionSplit(
      [
        { cooRegion: "CHINA", awardedDollars: 600, awardedUnits: 60 },
        { cooRegion: "ISC", awardedDollars: 400, awardedUnits: 40 },
      ],
      ["CHINA", "ISC"],
    );
    const sum = rows.reduce((s, r) => s + r.share, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(rows.find((r) => r.region === "CHINA")!.share).toBeCloseTo(0.6, 10);
  });

  it("marks a region nobody bid as noBids, distinct from bid-but-zero", () => {
    const rows = regionSplit(
      [{ cooRegion: "ISC", awardedDollars: 100, awardedUnits: 10 }],
      ["ISC", "SEA"],
    );
    const sea = rows.find((r) => r.region === "SEA")!;
    const emea = rows.find((r) => r.region === "EMEA")!;
    expect(sea.noBids).toBe(false); // bid, allocated nothing
    expect(sea.dollars).toBe(0);
    expect(emea.noBids).toBe(true); // nobody bid
  });

  it("carries an undeclared-COO vendor visibly rather than dropping it", () => {
    const rows = regionSplit(
      [
        { cooRegion: "ISC", awardedDollars: 500, awardedUnits: 50 },
        { cooRegion: null, awardedDollars: 500, awardedUnits: 50 },
      ],
      ["ISC", null],
    );
    const undeclared = rows.find((r) => r.region === "Undeclared");
    expect(undeclared).toBeDefined();
    expect(undeclared!.share).toBeCloseTo(0.5, 10);
    // Shares still sum to 1 — dropping it would silently sum to 0.5.
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
  });

  it("omits the undeclared row when every vendor has a region", () => {
    const rows = regionSplit(
      [{ cooRegion: "ISC", awardedDollars: 100, awardedUnits: 10 }],
      ["ISC"],
    );
    expect(rows.some((r) => r.region === "Undeclared")).toBe(false);
  });

  it("nothing allocated gives zero shares, not NaN", () => {
    const rows = regionSplit(
      [{ cooRegion: "ISC", awardedDollars: 0, awardedUnits: 0 }],
      ["ISC"],
    );
    for (const r of rows) expect(Number.isNaN(r.share)).toBe(false);
    expect(rows.every((r) => r.share === 0)).toBe(true);
  });
});

describe("splitFromInputs — typed award % to a comparable split", () => {
  it("drops zeroes so it compares equal to a stored split", () => {
    expect(splitFromInputs({ a: "50", b: "50", c: "0", d: "" })).toEqual({
      a: 50,
      b: 50,
    });
  });

  it("survives whitespace and junk without inventing a number", () => {
    // Number("   ") is 0, not NaN — the bug a test caught in the terms mapper.
    expect(splitFromInputs({ a: "  ", b: "abc", c: "100" })).toEqual({ c: 100 });
  });

  it("accepts numbers as well as strings", () => {
    expect(splitFromInputs({ a: 34, b: 33, c: 33 })).toEqual({
      a: 34,
      b: 33,
      c: 33,
    });
  });
});

describe("splitMatches — drives the `current` chip", () => {
  it("treats a missing vendor as zero", () => {
    // Same allocation, different key sets. An exact comparison would fail.
    expect(splitMatches({ a: 100 }, { a: 100, b: 0 })).toBe(true);
  });

  it("matches a 2dp split typed back in", () => {
    expect(splitMatches({ a: 34, b: 33, c: 33 }, { a: 34, b: 33, c: 33 })).toBe(
      true,
    );
  });

  it("does not match when one vendor differs", () => {
    expect(splitMatches({ a: 50, b: 50 }, { a: 60, b: 40 })).toBe(false);
  });

  it("does not match when a vendor is added", () => {
    expect(splitMatches({ a: 100 }, { a: 50, b: 50 })).toBe(false);
  });

  /** Nothing allocated means no card should claim to be current. */
  it("two empty splits are not a match", () => {
    expect(splitMatches({}, {})).toBe(false);
    expect(splitMatches({ a: 0 }, {})).toBe(false);
  });

  it("is symmetric", () => {
    const a = { x: 70, y: 30 };
    const b = { y: 30, x: 70 };
    expect(splitMatches(a, b)).toBe(splitMatches(b, a));
    expect(splitMatches(a, b)).toBe(true);
  });
});

describe("splitTotalsHundred — a saved strategy is award-ready", () => {
  it("accepts an exact 100", () => {
    expect(splitTotalsHundred({ a: 34, b: 33, c: 33 })).toBe(true);
  });

  it("rejects 99.99 — the case PUT refuses", () => {
    expect(splitTotalsHundred({ a: 33.33, b: 33.33, c: 33.33 })).toBe(false);
  });

  it("rejects over and under", () => {
    expect(splitTotalsHundred({ a: 60, b: 50 })).toBe(false);
    expect(splitTotalsHundred({ a: 40 })).toBe(false);
    expect(splitTotalsHundred({})).toBe(false);
  });

  /** Every built-in strategy must be saveable. */
  it("holds for every built-in proposal", () => {
    const bids = [
      bid({ vendorId: "a", bestCost: 8, cooRegion: "CHINA", isCurrentSupplier: true }),
      bid({ vendorId: "b", bestCost: 9, cooRegion: "ISC" }),
      bid({ vendorId: "c", bestCost: 10, cooRegion: "SEA", isNewToQuince: true }),
    ];
    for (const s of strategies(bids).filter((x) => !x.unavailable)) {
      expect(splitTotalsHundred(s.split), s.key).toBe(true);
    }
  });
});
