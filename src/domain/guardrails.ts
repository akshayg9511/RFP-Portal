/**
 * Guardrails — rules with a threshold measured against the SUM of award
 * decisions. A breach is invisible from any single product, which is why they
 * are computed here and shown live while allocating.
 *
 * Caps and floors behave differently, and the difference matters (Build Doc
 * 11.8):
 *
 *   A CAP breaches. It appears in the playground rail and in Wave Insights,
 *   and the person allocating can act on it.
 *
 *   A FLOOR is a wave target, not a breach. It appears ONLY in Wave Insights,
 *   because the allocator cannot fix it from a single style — Americas at 1.0%
 *   against a 7% floor needs 7x the current allocation, with only 25 of 1,725
 *   SKUs having gone there. That is a bidder-pool problem, not an allocation
 *   problem, and a guardrail that is permanently red and never fixable gets
 *   ignored within a week — along with everything displayed next to it.
 */

export type CooRule = { type: "cap" | "floor"; threshold: number };
export type CooRules = Record<string, CooRule>;

export type AwardRow = {
  styleId: string;
  vendorId: string;
  vendorName: string;
  cooRegion: string | null;
  isNewToQuince: boolean;
  awardedDollars: number;
};

export type CooStatus = {
  region: string;
  dollars: number;
  share: number;
  type: "cap" | "floor";
  threshold: number;
  /** Caps only. A floor is never "breached". */
  breached: boolean;
  /** Floors only — how far below target, in percentage points. */
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

    return {
      region,
      dollars,
      share,
      type: rule.type,
      threshold: rule.threshold,
      breached: rule.type === "cap" && share > rule.threshold,
      gapPoints:
        rule.type === "floor" && share < rule.threshold
          ? (rule.threshold - share) * 100
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
    const existing = byVendor.get(row.vendorId);
    if (existing) {
      existing.dollars += row.awardedDollars;
      continue;
    }

    const cap = row.isNewToQuince ? caps.new : caps.incumbentOrExisting;
    byVendor.set(row.vendorId, {
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      isNewToQuince: row.isNewToQuince,
      dollars: row.awardedDollars,
      cap,
      breached: false,
      headroom: cap,
    });
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
  stylesAllocated: number;
  stylesTotal: number;
  dollarsPlaced: number;
  dollarsPotential: number;
  shareOfDollarsPlaced: number;
};

export function coverage(
  stylesTotal: number,
  allocatedStyleIds: Set<string>,
  dollarsPlaced: number,
  dollarsPotential: number,
): Coverage {
  return {
    stylesAllocated: allocatedStyleIds.size,
    stylesTotal,
    dollarsPlaced,
    dollarsPotential,
    shareOfDollarsPlaced: dollarsPotential ? dollarsPlaced / dollarsPotential : 0,
  };
}

/**
 * Everything a live guardrail strip needs, including the edit in progress.
 * Recomputed on every keystroke in the Playground, so it must stay cheap.
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
