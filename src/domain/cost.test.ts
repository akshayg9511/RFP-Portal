import { describe, expect, it } from "vitest";
import {
  blended,
  computeCost,
  DEFAULT_BLEND,
  fobFromBuckets,
  landedAir,
  landedOcean,
} from "./cost";

/**
 * The reference case from Build Doc 11.4 — Wave 1 row M--5, JUNG KWANG INC.
 * These numbers are checked against columns P, Q and T of the real workbook.
 * If this test fails the demo's arithmetic is wrong, which is the one thing
 * that cannot be hand-waved on stage.
 */
describe("Build Doc §11.4 worked example", () => {
  const fob = 6.29;
  const tariffRate = 0.174;
  const ocean = 0.4992;
  const air = 1.7025;
  const ddpOcean = 7.49;
  const ddpAir = 9.77;

  it("landed ocean matches column P", () => {
    expect(landedOcean(fob, tariffRate, ocean)).toBeCloseTo(7.88366, 5);
  });

  it("landed air matches column Q", () => {
    expect(landedAir(fob, tariffRate, air)).toBeCloseTo(9.08696, 5);
  });

  it("Quince blend is 70/30 air/ocean", () => {
    const result = computeCost({
      fob,
      tariffRate,
      logisticsOcean: ocean,
      logisticsAir: air,
    });
    expect(result.quinceBlend).toBeCloseTo(8.72597, 5);
  });

  it("DDP blend uses the same 70/30", () => {
    expect(blended(ddpAir, ddpOcean)).toBeCloseTo(9.086, 3);
  });

  it("Best Cost is the lower of the two, and matches column T", () => {
    const result = computeCost({
      fob,
      tariffRate,
      logisticsOcean: ocean,
      logisticsAir: air,
      ddpOcean,
      ddpAir,
    });
    expect(result.bestCost).toBeCloseTo(8.72597, 5);
    expect(result.bestCostBasis).toBe("QUINCE_BLEND");
  });
});

describe("Best Cost basis", () => {
  const base = {
    fob: 10,
    tariffRate: 0.2,
    logisticsOcean: 1,
    logisticsAir: 3,
  };

  it("picks DDP when the vendor quotes lower", () => {
    const result = computeCost({ ...base, ddpOcean: 9, ddpAir: 9.5 });
    expect(result.bestCostBasis).toBe("DDP_BLEND");
    expect(result.bestCost).toBeCloseTo(9.35, 5);
  });

  it("falls back to the Quince blend when no DDP was quoted", () => {
    const result = computeCost(base);
    expect(result.ddpBlend).toBeNull();
    expect(result.bestCostBasis).toBe("QUINCE_BLEND");
  });

  it("treats a partial DDP quote as no quote", () => {
    // Only one leg quoted cannot be blended 70/30.
    const result = computeCost({ ...base, ddpAir: 9.5, ddpOcean: null });
    expect(result.ddpBlend).toBeNull();
    expect(result.bestCostBasis).toBe("QUINCE_BLEND");
  });
});

describe("blend", () => {
  it("defaults to the wave constant", () => {
    expect(DEFAULT_BLEND).toEqual({ air: 0.7, ocean: 0.3 });
  });

  it("honours an overridden blend", () => {
    const even = { air: 0.5, ocean: 0.5 };
    expect(blended(10, 20, even)).toBe(15);
  });
});

describe("fobFromBuckets", () => {
  // Verified against the curated catalog: the five components sum to
  // Product Cost to the penny.
  it("sums the five buckets", () => {
    expect(
      fobFromBuckets({
        BASE_MATERIALS: 70.46,
        CRAFTING: 3.03,
        TRIM_HARDWARE: 0.9,
        OVERHEAD_SGA_PROFIT: 0.77,
        PACKAGING: 0.3,
      }),
    ).toBeCloseTo(75.46, 2);
  });

  it("treats a missing bucket as zero", () => {
    expect(fobFromBuckets({ BASE_MATERIALS: 5 })).toBe(5);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   P3 / P5 — Quince's freight decision and the per-variant split (5 Oct).
   ──────────────────────────────────────────────────────────────────────────── */

describe("freight basis override (P3)", () => {
  // FOB 20, no tariff; QP ocean 21 / air 24 → QP blend 0.7*24 + 0.3*21 = 23.1.
  // DDP ocean 26 / air 32 (Akshay's example)  → DDP blend 0.7*32 + 0.3*26 = 30.2.
  const base = { fob: 20, tariffRate: 0, logisticsOcean: 1, logisticsAir: 4, ddpOcean: 26, ddpAir: 32 };

  it("is automatic by default — the cheaper blend", () => {
    const r = computeCost(base);
    expect(r.bestCostBasis).toBe("QUINCE_BLEND");
    expect(r.automaticBasis).toBe("QUINCE_BLEND");
    expect(r.overridden).toBe(false);
    expect(r.bestCost).toBeCloseTo(23.1, 6);
  });

  it("lets Quince choose DDP even when it is dearer, and says so", () => {
    const r = computeCost({ ...base, basis: "DDP_BLEND" });
    expect(r.bestCostBasis).toBe("DDP_BLEND");
    expect(r.bestCost).toBeCloseTo(30.2, 6);
    // The automatic answer travels with it, so the screen can show
    // "Quince chose DDP; automatic would pick Quince-paid".
    expect(r.automaticBasis).toBe("QUINCE_BLEND");
    expect(r.overridden).toBe(true);
  });

  it("IGNORES an override to DDP when there is no DDP quote", () => {
    // Choosing a price the vendor never gave must not cost the bid at zero.
    const r = computeCost({ fob: 20, tariffRate: 0, logisticsOcean: 1, logisticsAir: 4, basis: "DDP_BLEND" });
    expect(r.bestCostBasis).toBe("QUINCE_BLEND");
    expect(r.overridden).toBe(false);
    expect(r.bestCost).toBeCloseTo(23.1, 6);
  });

  it("ignores a one-mode DDP quote entirely (decided 5 Oct)", () => {
    const r = computeCost({ ...base, ddpOcean: null, basis: "DDP_BLEND" });
    expect(r.ddpBlend).toBeNull();
    expect(r.bestCostBasis).toBe("QUINCE_BLEND");
  });
});

describe("the per-variant air / ocean split (P5)", () => {
  it("applies the same split to BOTH bases", () => {
    // Akshay: 70/30 for Quince-paid between QP air and ocean, and 70/30 for
    // DDP between DDP air and ocean.
    const r = computeCost({
      fob: 20, tariffRate: 0, logisticsOcean: 1, logisticsAir: 4,
      ddpOcean: 26, ddpAir: 32, blend: { air: 0.4, ocean: 0.6 },
    });
    expect(r.quinceBlend).toBeCloseTo(0.4 * 24 + 0.6 * 21, 6);
    expect(r.ddpBlend!).toBeCloseTo(0.4 * 32 + 0.6 * 26, 6);
  });

  it("can change which basis is automatically cheaper", () => {
    // A split decides the comparison, so it must be per VARIANT and shared by
    // every vendor on it — two vendors on different splits are not comparable.
    const quote = { fob: 10, tariffRate: 0, logisticsOcean: 0.5, logisticsAir: 6, ddpOcean: 12, ddpAir: 13 };
    expect(computeCost({ ...quote, blend: { air: 0.9, ocean: 0.1 } }).bestCostBasis).toBe("DDP_BLEND");
    expect(computeCost({ ...quote, blend: { air: 0.1, ocean: 0.9 } }).bestCostBasis).toBe("QUINCE_BLEND");
  });
});
