/**
 * Award arithmetic — awarded dollars, units, savings, and the one hard
 * validation in the product.
 *
 * Pure functions, no framework imports. This runs in TWO places: the browser,
 * so the Playground's live readout recomputes on every keystroke without a
 * round trip, and the server, which recomputes authoritatively on save.
 */

export type VendorAllocation = {
  vendorId: string;
  vendorName: string;
  cooRegion: string | null;
  /** Per style x vendor. Must total exactly 100 across the style. */
  awardPct: number;
  bestCost: number;
  bestCostBasis: "QUINCE_BLEND" | "DDP_BLEND";
  isNewToQuince: boolean;
};

export type StyleAllocation = {
  styleId: string;
  planUnits: number;
  /**
   * The ceiling. A bid above it delivers no saving.
   *
   * MUST be a LANDED baseline, because bestCost is landed — it carries tariff
   * and freight. Comparing the two sides at different points in the chain is
   * the Wave 1 -$37,038 error, and it is symmetric: a landed cost against an
   * FOB baseline turns every real saving into an apparent increase, which is
   * exactly how Award Summary first reported -$8.29M.
   *
   * The rule is not "always FOB" or "always landed" — it is COMPARE LIKE WITH
   * LIKE, and Best Cost fixes which side that has to be.
   */
  baselineLanded: number;
  vendors: VendorAllocation[];
};

export type AllocationLine = {
  vendorId: string;
  vendorName: string;
  cooRegion: string | null;
  awardPct: number;
  bestCost: number;
  bestCostBasis: "QUINCE_BLEND" | "DDP_BLEND";
  awardedUnits: number;
  awardedDollars: number;
  savingsDollars: number;
};

export type AllocationResult = {
  lines: AllocationLine[];
  allocatedPct: number;
  remainingPct: number;
  /** The one hard rule: exactly 100%, never overridable. */
  isValid: boolean;
  totalAwardedDollars: number;
  totalSavingsDollars: number;
  /** Blended cost at this split — what the scenario lines compare against. */
  blendedCost: number;
  savingsPercent: number;
};

/**
 * Award % is entered once per style x vendor and must total exactly 100
 * (Build Doc 11.3). This is the origin of the Wave 1 500% bug: someone typed
 * 70% per size meaning "70% of Kings" while the model expected share of the
 * whole style, and 32 styles needed rebuilding. Nothing else in the product is
 * a hard block.
 */
export function allocate(style: StyleAllocation): AllocationResult {
  const lines: AllocationLine[] = style.vendors.map((v) => {
    const awardedUnits = Math.round(style.planUnits * (v.awardPct / 100));
    const awardedDollars = awardedUnits * v.bestCost;

    return {
      vendorId: v.vendorId,
      vendorName: v.vendorName,
      cooRegion: v.cooRegion,
      awardPct: v.awardPct,
      bestCost: v.bestCost,
      bestCostBasis: v.bestCostBasis,
      awardedUnits,
      awardedDollars,
      // Landed against landed. See the note on baselineLanded above.
      savingsDollars: awardedUnits * (style.baselineLanded - v.bestCost),
    };
  });

  const allocatedPct = round2(
    style.vendors.reduce((sum, v) => sum + v.awardPct, 0),
  );
  const totalAwardedDollars = lines.reduce((s, l) => s + l.awardedDollars, 0);
  const totalSavingsDollars = lines.reduce((s, l) => s + l.savingsDollars, 0);

  // Volume-weighted cost at this split.
  const blendedCost = style.vendors.reduce(
    (sum, v) => sum + v.bestCost * (v.awardPct / 100),
    0,
  );

  const baselineTotal = style.baselineLanded * style.planUnits;

  return {
    lines,
    allocatedPct,
    remainingPct: round2(100 - allocatedPct),
    isValid: Math.abs(allocatedPct - 100) < 0.005,
    totalAwardedDollars,
    totalSavingsDollars,
    blendedCost,
    savingsPercent: baselineTotal ? totalSavingsDollars / baselineTotal : 0,
  };
}

/**
 * Savings potential — the ceiling, before anything is allocated. The lowest
 * Best Cost at 100% against the annual baseline. This is what makes Award
 * Summary sortable by where the money actually is (Build Doc 11.6).
 *
 * `baselineLanded` must be landed, for the reason given on StyleAllocation:
 * bestCosts are landed, and comparing across the chain inverts the sign.
 */
export function savingsPotential(
  planUnits: number,
  baselineLanded: number,
  bestCosts: number[],
): number {
  if (!bestCosts.length) return 0;
  const lowest = Math.min(...bestCosts);
  return planUnits * (baselineLanded - lowest);
}

/**
 * The three scenarios (Build Doc 11.5). Reference lines only — they never write
 * values and never propose a split.
 *
 * Scenarios 1 and 2 are cost benchmarks: "what would this style cost if we went
 * that way". Only scenario 3 is naturally an allocation rule.
 */
export type ScenarioBid = {
  bestCost: number;
  isNewToQuince: boolean;
  isCurrentSupplier: boolean;
};

export type Scenarios = {
  bestCost: number | null;
  incumbent: number | null;
  ratio: number | null;
};

export function scenarios(
  bids: ScenarioBid[],
  ratio = { incumbent: 0.7, new: 0.3 },
): Scenarios {
  if (!bids.length) return { bestCost: null, incumbent: null, ratio: null };

  // 1 — average of up to the three lowest Best Costs.
  const lowest = [...bids]
    .sort((a, b) => a.bestCost - b.bestCost)
    .slice(0, 3)
    .map((b) => b.bestCost);
  const bestCost = mean(lowest);

  // 2 — average across vendors already inside the Quince ecosystem.
  const existing = bids.filter((b) => !b.isNewToQuince).map((b) => b.bestCost);
  const incumbent = existing.length ? mean(existing) : null;

  // 3 — the configured split between the best current supplier and the best
  // new vendor.
  const bestCurrent = min(
    bids.filter((b) => b.isCurrentSupplier).map((b) => b.bestCost),
  );
  const bestNew = min(
    bids.filter((b) => b.isNewToQuince).map((b) => b.bestCost),
  );
  const ratioCost =
    bestCurrent !== null && bestNew !== null
      ? bestCurrent * ratio.incumbent + bestNew * ratio.new
      : null;

  return { bestCost, incumbent, ratio: ratioCost };
}

/** UNTOUCHED -> ALLOCATED -> READY_FOR_REVIEW -> AWARDED (Build Doc 11.10). */
export type AwardStatus =
  | "UNTOUCHED"
  | "ALLOCATED"
  | "READY_FOR_REVIEW"
  | "AWARDED";

export function styleStatus(
  allocations: { awardPct: number; status?: string }[],
): AwardStatus {
  if (!allocations.length) return "UNTOUCHED";
  if (allocations.some((a) => a.status === "AWARDED")) return "AWARDED";
  if (allocations.some((a) => a.status === "READY_FOR_REVIEW")) {
    return "READY_FOR_REVIEW";
  }
  return "ALLOCATED";
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function min(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
