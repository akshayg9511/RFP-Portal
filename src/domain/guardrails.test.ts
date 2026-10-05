import { describe, expect, it } from "vitest";
import {
  coverage,
  cooBreakdown,
  guardrailStrip,
  unclassifiedDollars,
  vendorSpend,
  type AwardRow,
  type CooRules,
} from "./guardrails";

const RULES: CooRules = {
  CHINA: { min: 0, max: 0.3 },
  ISC: { min: 0, max: 0.3 },
  SEA: { min: 0.3, max: 0.6 },
  AMERICAS: { min: 0.07, max: 0.2 },
  EMEA: { min: 0.03, max: 0.2 },
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

describe("every region carries a RANGE, and both ends are measured", () => {
  const rows = [
    row("s1", "v1", "CHINA", 40),
    row("s2", "v2", "ISC", 20),
    row("s3", "v3", "SEA", 35),
    row("s4", "v4", "AMERICAS", 4),
    row("s5", "v5", "EMEA", 1),
  ];

  const at = (region: string) =>
    cooBreakdown(rows, RULES).find((c) => c.region === region)!;

  it("above max is over-max, not under-min", () => {
    const china = at("CHINA");
    expect(china.share).toBeCloseTo(0.4, 5);
    expect(china.overMax).toBe(true);
    expect(china.underMin).toBe(false);
    expect(china.gapPoints).toBeCloseTo(10, 1);
  });

  it("inside the range is neither, and reports NO gap", () => {
    const isc = at("ISC");
    expect(isc.overMax).toBe(false);
    expect(isc.underMin).toBe(false);
    // null, not zero — "on the boundary" and "not measured" must not collapse
    // into the same value.
    expect(isc.gapPoints).toBeNull();
  });

  it("below min is under-min, with the distance in points", () => {
    const americas = at("AMERICAS");
    expect(americas.share).toBeCloseTo(0.04, 5);
    expect(americas.underMin).toBe(true);
    expect(americas.overMax).toBe(false);
    expect(americas.gapPoints).toBeCloseTo(3, 1);
  });

  it("a region can be under its own minimum while another is over its maximum", () => {
    // The whole reason for two ends: concentration and thinness are different
    // failures and a single threshold cannot express both. Here CHINA is over
    // its 30% max at 40%, and AMERICAS is under its 7% min at 4% — both true at
    // once, in the same wave. SEA sits at 35%, inside 30-60%, and flags neither.
    expect(at("CHINA").overMax).toBe(true);
    expect(at("AMERICAS").underMin).toBe(true);
    expect(at("SEA").overMax).toBe(false);
    expect(at("SEA").underMin).toBe(false);
  });

  it("a region with no award still appears, at zero, and reads as under", () => {
    const only = [row("s1", "v1", "CHINA", 100)];
    const sea = cooBreakdown(only, RULES).find((c) => c.region === "SEA")!;
    expect(sea.dollars).toBe(0);
    expect(sea.underMin).toBe(true);
    expect(sea.gapPoints).toBeCloseTo(30, 1);
  });

  it("min 0 means no lower bound — a region at zero is not under", () => {
    const none = [row("s1", "v1", "SEA", 100)];
    const china = cooBreakdown(none, RULES).find((c) => c.region === "CHINA")!;
    expect(china.share).toBe(0);
    expect(china.underMin).toBe(false);
    expect(china.gapPoints).toBeNull();
  });

  it("exactly on a bound is INSIDE the range, not outside", () => {
    // A boundary value must not flag, or a wave tuned to sit exactly at its cap
    // reads as breached the moment it hits target.
    const exact = [
      row("s1", "v1", "CHINA", 30),
      row("s2", "v2", "SEA", 70),
    ];
    const china = cooBreakdown(exact, RULES).find((c) => c.region === "CHINA")!;
    expect(china.share).toBeCloseTo(0.3, 5);
    expect(china.overMax).toBe(false);
    expect(china.gapPoints).toBeNull();
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


describe("coverage — progress is baseline-against-baseline", () => {
  /**
   * This function previously divided committed spend (awarded units x Best
   * Cost) by baseline value (plan units x baseline landed). Two quantities from
   * different points in the cost chain — the same class of error as the Wave 1
   * -$37,038 defect, and it produced 133% "decided" on a style allocated above
   * its own baseline.
   */
  const inPlay = [
    { styleId: "a", units: 100, baselineValue: 1000 },
    { styleId: "b", units: 200, baselineValue: 4000 },
    { styleId: "c", units: 300, baselineValue: 5000 },
  ];

  it("measures the share of biddable BASELINE value decided", () => {
    const c = coverage({
      inPlay,
      decidedStyleIds: new Set(["a", "b"]),
      committedSpend: 4500,
    });
    // 1000 + 4000 of 10000 — value-weighted, not a product count.
    expect(c.baselineDecided).toBe(5000);
    expect(c.baselineInPlay).toBe(10000);
    expect(c.shareDecided).toBeCloseTo(0.5, 6);
  });

  it("NEVER exceeds 100%, even when spend exceeds baseline", () => {
    // The regression. A style awarded above its own baseline is real — two are
    // seeded deliberately for the cost-increase block — and must not make
    // progress read as 133%.
    const c = coverage({
      inPlay,
      decidedStyleIds: new Set(["a", "b", "c"]),
      committedSpend: 99_999,
    });
    expect(c.shareDecided).toBe(1);
    expect(c.savings).toBeLessThan(0);
  });

  it("does not FALL when we negotiate a better price", () => {
    // The old ratio put spend in the numerator, so a cheaper award read as less
    // progress. Progress must depend only on WHAT is decided.
    const expensive = coverage({ inPlay, decidedStyleIds: new Set(["b"]), committedSpend: 3900 });
    const cheap = coverage({ inPlay, decidedStyleIds: new Set(["b"]), committedSpend: 2000 });
    expect(cheap.shareDecided).toBe(expensive.shareDecided);
    expect(cheap.savings).toBeGreaterThan(expensive.savings);
  });

  it("ignores an award on a style with no submitted bid", () => {
    // Otherwise the numerator counts it and the denominator does not, which
    // drives "still to decide" negative.
    const c = coverage({
      inPlay,
      decidedStyleIds: new Set(["a", "ghost"]),
      committedSpend: 900,
    });
    expect(c.stylesDecided).toBe(1);
    expect(c.stylesInPlay - c.stylesDecided).toBeGreaterThanOrEqual(0);
  });

  it("savings is measured against DECIDED baseline, not the whole wave", () => {
    const c = coverage({
      inPlay,
      decidedStyleIds: new Set(["a"]),
      committedSpend: 800,
    });
    expect(c.savings).toBe(200);
    // 200/1000, not 200/10000 — measuring against untouched styles would
    // understate every saving.
    expect(c.savingsPercent).toBeCloseTo(0.2, 6);
  });

  it("an empty wave is zero everywhere rather than NaN", () => {
    const c = coverage({ inPlay: [], decidedStyleIds: new Set(), committedSpend: 0 });
    expect(c.shareDecided).toBe(0);
    expect(c.savingsPercent).toBe(0);
    expect(Number.isNaN(c.shareDecided)).toBe(false);
  });
});

/* N14 — the cap bar's three colours. */
describe("vendorSpend splits each vendor into incumbent / existing / new", () => {
  const caps = { incumbentOrExisting: 20_000_000, new: 5_000_000 };
  const row = (vendorId: string, styleId: string, dollars: number, o: { isNew?: boolean; isIncumbent?: boolean } = {}) => ({
    styleId, vendorId, vendorName: vendorId, cooRegion: "ISC",
    isNewToQuince: o.isNew ?? false, isIncumbent: o.isIncumbent ?? false,
    awardedDollars: dollars,
  });

  it("splits an existing vendor by the styles it already supplies", () => {
    // Akshay's example: 5 products, already serving 2.
    const [v] = vendorSpend([
      row("A", "s1", 100, { isIncumbent: true }),
      row("A", "s2", 200, { isIncumbent: true }),
      row("A", "s3", 50),
      row("A", "s4", 50),
      row("A", "s5", 100),
    ], caps);
    expect(v!.split).toEqual({ incumbent: 300, existing: 200, new: 0 });
  });

  it("puts a new vendor entirely in 'new', even if a row claims incumbency", () => {
    const [v] = vendorSpend([row("B", "s1", 400, { isNew: true, isIncumbent: true })], caps);
    expect(v!.split).toEqual({ incumbent: 0, existing: 0, new: 400 });
  });

  it("always sums the three parts to the vendor's total", () => {
    const out = vendorSpend([
      row("A", "s1", 120, { isIncumbent: true }),
      row("A", "s2", 80),
      row("B", "s1", 60, { isNew: true }),
    ], caps);
    for (const v of out) {
      expect(v.split.incumbent + v.split.existing + v.split.new).toBeCloseTo(v.dollars, 6);
    }
  });

  it("leaves pre-N14 callers unchanged — no isIncumbent means existing", () => {
    const [v] = vendorSpend([{ styleId: "s", vendorId: "A", vendorName: "A", cooRegion: null, isNewToQuince: false, awardedDollars: 10 }], caps);
    expect(v!.dollars).toBe(10);
    expect(v!.split.existing).toBe(10);
  });
});
