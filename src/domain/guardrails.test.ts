import { describe, expect, it } from "vitest";
import {
  cooBreakdown,
  guardrailStrip,
  unclassifiedDollars,
  vendorSpend,
  type AwardRow,
  type CooRules,
} from "./guardrails";

const RULES: CooRules = {
  CHINA: { type: "cap", threshold: 0.3 },
  ISC: { type: "cap", threshold: 0.3 },
  SEA: { type: "floor", threshold: 0.3 },
  AMERICAS: { type: "floor", threshold: 0.07 },
  EMEA: { type: "floor", threshold: 0.03 },
};

const row = (
  styleId: string,
  vendorId: string,
  cooRegion: string | null,
  awardedDollars: number,
  isNewToQuince = false,
): AwardRow => ({
  styleId,
  vendorId,
  vendorName: vendorId,
  cooRegion,
  isNewToQuince,
  awardedDollars,
});

describe("COO caps and floors behave differently", () => {
  const rows = [
    row("s1", "v1", "CHINA", 40),
    row("s2", "v2", "ISC", 20),
    row("s3", "v3", "SEA", 35),
    row("s4", "v4", "AMERICAS", 4),
    row("s5", "v5", "EMEA", 1),
  ];

  it("a cap over threshold breaches", () => {
    const china = cooBreakdown(rows, RULES).find((c) => c.region === "CHINA")!;
    expect(china.share).toBeCloseTo(0.4, 5);
    expect(china.breached).toBe(true);
  });

  it("a cap under threshold does not", () => {
    const isc = cooBreakdown(rows, RULES).find((c) => c.region === "ISC")!;
    expect(isc.breached).toBe(false);
  });

  it("a floor below target is NEVER a breach — it is a gap", () => {
    // The distinction the Build Doc is emphatic about: a floor the allocator
    // cannot fix from a single style must not render as a breach, or the whole
    // rail gets ignored.
    const americas = cooBreakdown(rows, RULES).find(
      (c) => c.region === "AMERICAS",
    )!;
    expect(americas.breached).toBe(false);
    expect(americas.gapPoints).toBeCloseTo(3, 1);
  });

  it("a floor at or above target reports no gap", () => {
    const sea = cooBreakdown(rows, RULES).find((c) => c.region === "SEA")!;
    expect(sea.gapPoints).toBeNull();
  });

  it("a region with no award still appears, at zero", () => {
    const only = [row("s1", "v1", "CHINA", 100)];
    const sea = cooBreakdown(only, RULES).find((c) => c.region === "SEA")!;
    expect(sea.dollars).toBe(0);
    expect(sea.gapPoints).toBeCloseTo(30, 1);
  });
});

describe("undeclared COO", () => {
  // Never silently bucketed — it would move a threshold on a fiction.
  const rows = [row("s1", "v1", "CHINA", 50), row("s2", "v2", null, 50)];

  it("is excluded from every region", () => {
    const total = cooBreakdown(rows, RULES).reduce((s, c) => s + c.dollars, 0);
    expect(total).toBe(50);
  });

  it("is reported separately", () => {
    expect(unclassifiedDollars(rows)).toBe(50);
  });

  it("China's share is measured against the declared total", () => {
    const china = cooBreakdown(rows, RULES).find((c) => c.region === "CHINA")!;
    expect(china.share).toBe(1);
  });
});

describe("vendor spend cap", () => {
  const caps = { incumbentOrExisting: 20_000_000, new: 10_000_000 };

  it("sums a vendor across every style — one cap per vendor", () => {
    // The Wave 1 workbook computed this per vendor AND type, so one vendor
    // appeared three times, each under its own threshold, each showing OK.
    const rows = [
      row("s1", "v1", "CHINA", 8_000_000),
      row("s2", "v1", "CHINA", 9_000_000),
      row("s3", "v1", "CHINA", 5_000_000),
    ];
    const spend = vendorSpend(rows, caps);
    expect(spend).toHaveLength(1);
    expect(spend[0].dollars).toBe(22_000_000);
    expect(spend[0].breached).toBe(true);
  });

  it("applies the lower cap to a new vendor", () => {
    const rows = [row("s1", "v2", "SEA", 12_000_000, true)];
    const spend = vendorSpend(rows, caps);
    expect(spend[0].cap).toBe(10_000_000);
    expect(spend[0].breached).toBe(true);
  });

  it("reports headroom", () => {
    const rows = [row("s1", "v1", "CHINA", 18_200_000)];
    expect(vendorSpend(rows, caps)[0].headroom).toBe(1_800_000);
  });

  it("sorts by spend, so the vendor nearest its cap leads", () => {
    const rows = [
      row("s1", "small", "CHINA", 1_000),
      row("s2", "big", "CHINA", 9_000),
    ];
    expect(vendorSpend(rows, caps)[0].vendorId).toBe("big");
  });
});

describe("live strip with a pending edit", () => {
  // The Playground recomputes on every keystroke, and the edit in progress must
  // REPLACE the saved allocation for that style rather than stack on top of it.
  const committed = [
    row("s1", "v1", "CHINA", 30),
    row("s2", "v2", "SEA", 70),
  ];

  it("replaces the committed rows for the style being edited", () => {
    const pending = [row("s1", "v3", "SEA", 30)];
    const strip = guardrailStrip(committed, pending, RULES, {
      incumbentOrExisting: 1e9,
      new: 1e9,
    });

    const china = strip.coo.find((c) => c.region === "CHINA")!;
    expect(china.dollars).toBe(0);
    const sea = strip.coo.find((c) => c.region === "SEA")!;
    expect(sea.dollars).toBe(100);
  });

  it("leaves other styles untouched", () => {
    const pending = [row("s1", "v1", "CHINA", 60)];
    const strip = guardrailStrip(committed, pending, RULES, {
      incumbentOrExisting: 1e9,
      new: 1e9,
    });
    expect(strip.coo.find((c) => c.region === "SEA")!.dollars).toBe(70);
    expect(strip.coo.find((c) => c.region === "CHINA")!.dollars).toBe(60);
  });

  it("with no pending edit, matches the committed state", () => {
    const strip = guardrailStrip(committed, [], RULES, {
      incumbentOrExisting: 1e9,
      new: 1e9,
    });
    expect(strip.coo.find((c) => c.region === "CHINA")!.share).toBeCloseTo(0.3, 5);
  });
});
