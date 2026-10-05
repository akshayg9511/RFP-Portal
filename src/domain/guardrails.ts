/**
 * Guardrails — rules measured against the SUM of award decisions. A breach is
 * invisible from any single product, which is why they are computed here and
 * shown live while allocating.
 *
 * EVERY REGION CARRIES A RANGE, min to max. A region can be wrong in two
 * directions: too concentrated (the Wave 1 problem) or too thin to be a real
 * second source. A rule with only one end cannot express that — a region with
 * no max could absorb the entire wave without ever flagging.
 *
 * The two ends behave differently, and the difference decides where each is
 * shown (Build Doc 11.8):
 *
 *   OVER MAX is actionable from one style. Move percentage off that vendor and
 *   the number falls. It appears in the playground rail AND in Wave Insights.
 *
 *   UNDER MIN usually is not. Americas bids on 3 of 10 styles, so no allocation
 *   reaches its 7% minimum without changing the bidder pool. It appears ONLY in
 *   Wave Insights, because a rail that is permanently red and never fixable
 *   gets ignored within a week — along with everything displayed next to it.
 *
 * Neither end ever blocks a save. Exactly-100% per style remains the only hard
 * validation in the product.
 */

export type CooRule = {
  /** Lower bound as a fraction. 0 means "no minimum". */
  min: number;
  /** Upper bound as a fraction. 1 means "no maximum". */
  max: number;
};
export type CooRules = Record<string, CooRule>;

export type AwardRow = {
  styleId: string;
  vendorId: string;
  vendorName: string;
  cooRegion: string | null;
  isNewToQuince: boolean;
  awardedDollars: number;
  /**
   * Does this vendor CURRENTLY supply this style? A property of the
   * style x vendor PAIR, derived from CurrentSupplier and never stored
   * (Build Doc 3.7). Optional so every pre-N14 caller is unchanged.
   */
  isIncumbent?: boolean;
};

export type CooStatus = {
  region: string;
  dollars: number;
  share: number;
  min: number;
  max: number;
  /** Above the upper bound — actionable from a single style. */
  overMax: boolean;
  /** Below the lower bound — a wave-level target, usually not fixable here. */
  underMin: boolean;
  /** How far outside the range, in percentage points. Null when within. */
  gapPoints: number | null;
};

export function cooBreakdown(rows: AwardRow[], rules: CooRules): CooStatus[] {
  const byRegion = new Map<string, number>();
  let declaredTotal = 0;

  for (const row of rows) {
    // An undeclared region never joins a bucket — it would silently move a
    // threshold. It is reported separately as unclassified.
    if (!row.cooRegion) continue;
    declaredTotal += row.awardedDollars;
    byRegion.set(
      row.cooRegion,
      (byRegion.get(row.cooRegion) ?? 0) + row.awardedDollars,
    );
  }

  // Shares are measured against the DECLARED total, not every award dollar.
  // Dividing by the full total would let undeclared spend quietly dilute
  // China's percentage and hide a breach — the same silent-pass failure the
  // Build Doc rejects for capacity (§11.8). Undeclared dollars are surfaced
  // separately by unclassifiedDollars().
  const total = declaredTotal;

  return Object.entries(rules).map(([region, rule]) => {
    const dollars = byRegion.get(region) ?? 0;
    const share = total ? dollars / total : 0;

    const overMax = share > rule.max;
    const underMin = share < rule.min;

    return {
      region,
      dollars,
      share,
      min: rule.min,
      max: rule.max,
      overMax,
      underMin,
      // Distance outside the range, whichever end was missed. A region inside
      // its range has no gap — null, not zero, so "on the boundary" and
      // "not measured" cannot be confused.
      gapPoints: overMax
        ? (share - rule.max) * 100
        : underMin
          ? (rule.min - share) * 100
          : null,
    };
  });
}

/** Award dollars carrying no COO — reported, never silently bucketed. */
export function unclassifiedDollars(rows: AwardRow[]): number {
  return rows
    .filter((r) => !r.cooRegion)
    .reduce((s, r) => s + r.awardedDollars, 0);
}

export type SpendCaps = { incumbentOrExisting: number; new: number };

export type VendorSpend = {
  vendorId: string;
  vendorName: string;
  isNewToQuince: boolean;
  dollars: number;
  cap: number;
  breached: boolean;
  headroom: number;
  /**
   * The bar's three colours — decision N14, 5 Oct.
   *
   * Akshay: "For the products they were already serving, those will come
   * under incumbent, which is a subpart of existing, but it is still
   * incumbent. The rest, where it was not serving, will be existing, and the
   * remaining will be new."
   *
   * So an EXISTING vendor splits into incumbent + existing, and a NEW vendor
   * is new only — a vendor new to Quince supplies nothing today and cannot be
   * an incumbent. The three always sum to `dollars`.
   */
  split: { incumbent: number; existing: number; new: number };
};

/**
 * Vendor spend, computed PER VENDOR IN TOTAL across every style.
 *
 * The Wave 1 workbook computed it per vendor AND type, so AIT appeared three
 * times — Existing, Incumbent and New — each measured against its own threshold
 * and each showing OK. Vendor type is frozen at wave start, so a vendor carries
 * exactly one cap for the wave.
 */
export function vendorSpend(rows: AwardRow[], caps: SpendCaps): VendorSpend[] {
  const byVendor = new Map<string, VendorSpend>();

  for (const row of rows) {
    let v = byVendor.get(row.vendorId);
    if (!v) {
      const cap = row.isNewToQuince ? caps.new : caps.incumbentOrExisting;
      v = {
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        isNewToQuince: row.isNewToQuince,
        dollars: 0,
        cap,
        breached: false,
        headroom: cap,
        split: { incumbent: 0, existing: 0, new: 0 },
      };
      byVendor.set(row.vendorId, v);
    }

    v.dollars += row.awardedDollars;
    // New-to-Quince wins over incumbency: such a vendor supplies nothing
    // today, so an `isIncumbent` flag on it would be a data error, not a
    // reason to colour it as one.
    const bucket = row.isNewToQuince
      ? "new"
      : row.isIncumbent
        ? "incumbent"
        : "existing";
    v.split[bucket] += row.awardedDollars;
  }

  for (const v of byVendor.values()) {
    v.breached = v.dollars > v.cap;
    v.headroom = v.cap - v.dollars;
  }

  return [...byVendor.values()].sort((a, b) => b.dollars - a.dollars);
}

/**
 * Coverage — required, not decorative. China at 29% means something completely
 * different at 40% coverage than at 95%; without it every number on Wave
 * Insights is unreadable until the wave is nearly finished, and people either
 * panic early or relax early (Build Doc 11.9).
 */
export type Coverage = {
  /** Styles with an award row. */
  stylesDecided: number;
  /** Styles with at least one submitted bid — what is decidable. */
  stylesInPlay: number;
  /** Plan units on decided styles / on all in-play styles. */
  unitsDecided: number;
  unitsInPlay: number;
  /** BASELINE value, both sides. This is what the headline percentage uses. */
  baselineDecided: number;
  baselineInPlay: number;
  /** The headline: share of biddable baseline value now decided. 0..1. */
  shareDecided: number;
  /** What we will actually pay for the decided styles, at Best Cost. */
  committedSpend: number;
  /** baselineDecided - committedSpend. Savings, kept separate from progress. */
  savings: number;
  savingsPercent: number;
};

/**
 * PROGRESS IS MEASURED BASELINE-AGAINST-BASELINE, and savings is a separate
 * number. This function used to divide committed spend (awarded units x Best
 * Cost) by baseline value (plan units x baseline landed) — two quantities from
 * different points in the cost chain, which is the single most expensive class
 * of error in this build and the one the Wave 1 workbook itself made.
 *
 * Two things were wrong with that ratio:
 *
 *   It FELL when we negotiated well. Spend is the numerator, so a better price
 *   read as less progress — backwards for a progress measure.
 *
 *   It could exceed 100%. A style allocated above its own baseline (the
 *   deliberate cost-increase cases) reported 133% and 120% decided, which is
 *   not a meaningful quantity.
 *
 * Now: how much of the biddable baseline value has been decided, and separately
 * what that decision costs against the same baseline.
 */
export function coverage(input: {
  /** Styles with >= 1 submitted bid: plan units and baseline landed each. */
  inPlay: { styleId: string; units: number; baselineValue: number }[];
  /** Styles carrying an award row. */
  decidedStyleIds: Set<string>;
  /** Sum of awardedDollars across award rows — at Best Cost. */
  committedSpend: number;
}): Coverage {
  // Only count a decided style that is actually in play. An award on a style
  // with no submitted bid would otherwise inflate the numerator and leave the
  // denominator untouched, which can drive "still open" negative.
  const decided = input.inPlay.filter((s) => input.decidedStyleIds.has(s.styleId));

  const sum = (rows: typeof input.inPlay, key: "units" | "baselineValue") =>
    rows.reduce((total, r) => total + r[key], 0);

  const baselineDecided = sum(decided, "baselineValue");
  const baselineInPlay = sum(input.inPlay, "baselineValue");
  const savings = baselineDecided - input.committedSpend;

  return {
    stylesDecided: decided.length,
    stylesInPlay: input.inPlay.length,
    unitsDecided: sum(decided, "units"),
    unitsInPlay: sum(input.inPlay, "units"),
    baselineDecided,
    baselineInPlay,
    shareDecided: baselineInPlay ? baselineDecided / baselineInPlay : 0,
    committedSpend: input.committedSpend,
    savings,
    // Against the baseline of what was DECIDED, not the whole wave — a saving
    // measured against styles nobody has touched would understate it.
    savingsPercent: baselineDecided ? savings / baselineDecided : 0,
  };
}

/**
 * Everything a live guardrail strip needs, including the edit in progress.
 *
 * DORMANT as of 17 Sep — zero callers in product code, kept because it is
 * tested and a wave-level "what if I changed this style" rail may want it.
 *
 * Its only consumer was the Playground drawer's per-product guardrail rail,
 * which was deleted along with the drawer: a per-product cap was never
 * coherent, because China's 30% ceiling is a property of the WAVE and one
 * product is a single contributor to it. The product screen now shows an
 * informational region split instead, and Wave Insights keeps the real
 * guardrails through cooBreakdown/vendorSpend/coverage.
 *
 * MIND THE INVARIANT if you wire this up again: it drops committed rows by
 * `styleId`, NOT by `styleId|vendorId`, so passing a partial pending set
 * silently deletes the rest of that style from the wave totals and China
 * reads LOW. That trap is why the product screen is better off without it.
 */
export type GuardrailStrip = {
  coo: CooStatus[];
  vendors: VendorSpend[];
  unclassified: number;
};

export function guardrailStrip(
  committed: AwardRow[],
  pending: AwardRow[],
  rules: CooRules,
  caps: SpendCaps,
): GuardrailStrip {
  // The pending edit replaces any committed row for the same style x vendor,
  // so typing a percentage does not double-count against what is saved.
  const pendingKeys = new Set(pending.map((r) => `${r.styleId}|${r.vendorId}`));
  const pendingStyles = new Set(pending.map((r) => r.styleId));

  const merged = [
    ...committed.filter(
      (r) =>
        !pendingKeys.has(`${r.styleId}|${r.vendorId}`) &&
        !pendingStyles.has(r.styleId),
    ),
    ...pending,
  ];

  return {
    coo: cooBreakdown(merged, rules),
    vendors: vendorSpend(merged, caps),
    unclassified: unclassifiedDollars(merged),
  };
}
