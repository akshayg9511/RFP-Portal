import { describe, expect, it } from "vitest";
import { ddpByMode, resolveBestCost, resolveLogistics, resolveTariff, type RateBook } from "./bestCost";

/**
 * The cost chain on the READ path.
 *
 * `domain/cost.test.ts` already proves the arithmetic. What is proved here is
 * the lookup layer: that the right tariff and logistics rows are chosen, and
 * that six DDP numbers collapse to a comparable pair the way we decided —
 * highest destination per mode, never the cheapest.
 */

const blank = {
  ddpWest: null,
  ddpCentral: null,
  ddpEast: null,
  ddpWestAir: null,
  ddpCentralAir: null,
  ddpEastAir: null,
};

const rates: RateBook = {
  tariff: new Map([["6302219020|CN", 0.174]]),
  logistics: new Map([
    ["U-BEDD-138|", { ocean: 1.0, air: 2.0 }],
    ["U-BEDD-138|KING", { ocean: 1.5, air: 3.0 }],
  ]),
  cooMedian: new Map([["IN", { ocean: 1.193, air: 6.531 }]]),
  blend: { air: 0.7, ocean: 0.3 },
};

const style = { styleNumber: "U-BEDD-138", htsCode: "6302219020" };
const vendor = { countryIso: "CN" };

describe("Build Doc 11.4 — the worked example, through the read path", () => {
  it("reproduces Best Cost 8.72597 from FOB 6.29 at 17.4%", () => {
    // The reference row, Wave 1 M--5 / JUNG KWANG INC: the same inputs
    // domain/cost.test.ts asserts against, reached through the lookup layer.
    const book: RateBook = {
      ...rates,
      logistics: new Map([["REF|", { ocean: 0.4992, air: 1.7025 }]]),
    };

    const result = resolveBestCost(
      { fob: 6.29, ...blank },
      { styleNumber: "REF", htsCode: "6302219020" },
      vendor,
      book,
    );

    expect(result).not.toBeNull();
    expect(result!.bestCost).toBeCloseTo(8.72597, 5);
    expect(result!.bestCostBasis).toBe("QUINCE_BLEND");
  });
});

describe("DDP collapses to one number per mode — the HIGHEST destination", () => {
  it("takes the dearest destination in each mode, not the cheapest", () => {
    const { ddpOcean, ddpAir } = ddpByMode({
      fob: 10,
      ddpWest: 9.0,
      ddpCentral: 9.2,
      ddpEast: 9.45,
      ddpWestAir: 12.0,
      ddpCentralAir: 12.3,
      ddpEastAir: 12.6,
    });

    expect(ddpOcean).toBe(9.45);
    expect(ddpAir).toBe(12.6);
  });

  it("a DDP bid that would win at its CHEAPEST destination still loses at its dearest", () => {
    // Quince blend here is 6.29*1.174 + blend(2.0, 1.0) = 7.3845 + 1.7 = 9.0845.
    // West-only DDP (8.50 / 8.80) would beat that; the East pair does not.
    const result = resolveBestCost(
      {
        fob: 6.29,
        ddpWest: 8.5,
        ddpCentral: 8.9,
        ddpEast: 9.6,
        ddpWestAir: 8.8,
        ddpCentralAir: 9.2,
        ddpEastAir: 9.9,
      },
      style,
      vendor,
      rates,
    );

    expect(result!.bestCostBasis).toBe("QUINCE_BLEND");
    // Had we taken the lowest destination, DDP would have won — this is the
    // decision under test, not an incidental.
    expect(result!.ddpBlend!).toBeGreaterThan(result!.quinceBlend);
  });

  it("DDP wins when it beats the Quince blend even at its dearest destination", () => {
    const result = resolveBestCost(
      {
        fob: 6.29,
        ddpWest: 7.9,
        ddpCentral: 8.0,
        ddpEast: 8.1,
        ddpWestAir: 8.2,
        ddpCentralAir: 8.3,
        ddpEastAir: 8.4,
      },
      style,
      vendor,
      rates,
    );

    expect(result!.bestCostBasis).toBe("DDP_BLEND");
    expect(result!.bestCost).toBeCloseTo(0.7 * 8.4 + 0.3 * 8.1, 5);
  });

  it("one mode missing means no DDP comparison at all", () => {
    // A vendor who priced ocean but not air has not given a comparable quote.
    const result = resolveBestCost(
      { fob: 6.29, ...blank, ddpWest: 7.0, ddpCentral: 7.1, ddpEast: 7.2 },
      style,
      vendor,
      rates,
    );

    expect(result!.ddpBlend).toBeNull();
    expect(result!.bestCostBasis).toBe("QUINCE_BLEND");
  });

  it("no DDP at all is null, not zero", () => {
    const { ddpOcean, ddpAir } = ddpByMode({ fob: 1, ...blank });
    expect(ddpOcean).toBeNull();
    expect(ddpAir).toBeNull();
  });
});

describe("rate lookups", () => {
  it("prefers an exact style+size logistics row", () => {
    expect(resolveLogistics(rates, "U-BEDD-138", "CN", "KING")).toEqual({
      ocean: 1.5,
      air: 3.0,
    });
  });

  it("falls back to the style-level row when the size has none", () => {
    expect(resolveLogistics(rates, "U-BEDD-138", "CN", "TWIN")).toEqual({
      ocean: 1.0,
      air: 2.0,
    });
  });

  it("falls back to the COO median when the style has no row", () => {
    expect(resolveLogistics(rates, "U-UNKNOWN", "IN")).toEqual({
      ocean: 1.193,
      air: 6.531,
    });
  });

  it("resolves tariff on hts + country", () => {
    expect(resolveTariff(rates, "6302219020", "CN")).toBeCloseTo(0.174, 6);
  });

  it("an unknown hts/country pair is zero tariff, not NaN", () => {
    expect(resolveTariff(rates, "9999999999", "CN")).toBe(0);
    expect(resolveTariff(rates, null, "CN")).toBe(0);
  });
});

describe("a quote with no FOB", () => {
  it("returns null rather than pricing it at zero", () => {
    const result = resolveBestCost({ fob: null, ...blank }, style, vendor, rates);
    expect(result).toBeNull();
  });
});
