/**
 * Award STRATEGIES — named allocation rules the buyer can apply.
 *
 * Pure functions, no framework imports.
 *
 * ## Why these are not the "three scenarios"
 *
 * `scenarios()` in this folder returns UNIT COSTS: "the mean of the three
 * lowest bids" is a price benchmark answering *what would a unit cost if we
 * went that way*. A strategy answers a different question — *who gets what
 * percentage* — and the savings follow from that split.
 *
 * The two are one word apart and completely different arithmetic. "Three
 * lowest" as a benchmark is a mean of three numbers; "three lowest" as a
 * strategy is a 33/33/34 split across three vendors, whose blended cost is
 * only the same number by coincidence (it is equal when the split is even AND
 * every vendor ships the same units — which `allocate()` rounds, so not even
 * then). Conflating them would report a saving nobody can reproduce.
 *
 * ## The one rule that matters
 *
 * A STRATEGY ONLY EVER PROPOSES PERCENTAGES. It never computes money.
 * `allocate()` stays the single source of truth for awarded dollars, units and
 * savings — so a new strategy is a rule about who, not a second implementation
 * of the cost chain. This is deliberate: the build has already produced five
 * bugs from comparing quantities taken at different points in that chain.
 *
 * Every proposal totals exactly 100, because `PUT /api/styles/[id]/award`
 * rejects anything else and that validation is never overridable.
 */

/** What a strategy needs to know about one bid. Deliberately minimal. */
export type StrategyBid = {
  vendorId: string;
  bestCost: number;
  cooRegion: string | null;
  isNewToQuince: boolean;
  isCurrentSupplier: boolean;
};

export type StrategyKey =
  | "LOWEST"
  | "THREE_LOWEST_EXISTING"
  | "EQUAL_NON_CHINA"
  | "INCUMBENT_NEW_RATIO";

export type StrategyProposal = {
  key: StrategyKey;
  label: string;
  /** What the rule is, in the buyer's words. Shown under the label. */
  rule: string;
  /** vendorId -> award %. Totals exactly 100. Empty when unavailable. */
  split: Record<string, number>;
  /**
   * Set when the rule cannot be built from these bids. The card is shown
   * DISABLED carrying this sentence — hiding it would leave the buyer
   * wondering whether the option exists, and "no non-China vendor bid this"
   * is itself a finding worth reading.
   */
  unavailable: string | null;
};

const CHINA = "CHINA";

/**
 * Split 100 evenly, giving the remainder to the FIRST vendor.
 *
 * Callers pass vendors cheapest-first, so the odd cents land on the cheapest
 * bid — the split a buyer would make by hand. Three vendors give 34/33/33, not
 * 33.33 each: award % is stored to 2dp but an even three-way split is
 * irrational, and `allocate()` requires the total to be exactly 100.
 */
function evenSplit(vendorIds: string[]): Record<string, number> {
  const n = vendorIds.length;
  if (n === 0) return {};
  const each = Math.floor(100 / n);
  const remainder = 100 - each * n;
  const split: Record<string, number> = {};
  vendorIds.forEach((id, i) => {
    split[id] = each + (i === 0 ? remainder : 0);
  });
  return split;
}

/** Cheapest first. Ties keep input order, so the result is deterministic. */
function byCost(bids: StrategyBid[]): StrategyBid[] {
  return [...bids].sort((a, b) => a.bestCost - b.bestCost);
}

/**
 * Build every strategy for one product's bids.
 *
 * Returns them in a fixed order — the buyer compares cards by position, so the
 * order must not shuffle when a strategy becomes unavailable.
 */
export function strategies(
  bids: StrategyBid[],
  ratio: { incumbent: number; new: number } = { incumbent: 0.7, new: 0.3 },
): StrategyProposal[] {
  const ranked = byCost(bids);

  return [
    lowestOnly(ranked),
    threeLowestExisting(ranked),
    equalNonChina(ranked),
    incumbentNewRatio(ranked, ratio),
  ];
}

/** 100% to the cheapest Best Cost. The savings ceiling. */
function lowestOnly(ranked: StrategyBid[]): StrategyProposal {
  const base = {
    key: "LOWEST" as const,
    label: "Lowest bid only",
    rule: "All volume to the cheapest Best Cost",
  };
  if (!ranked.length) {
    return { ...base, split: {}, unavailable: "No bids on this product yet." };
  }
  return { ...base, split: { [ranked[0].vendorId]: 100 }, unavailable: null };
}

/**
 * Equal split across the three cheapest vendors ALREADY inside the Quince
 * ecosystem (`!isNewToQuince`).
 *
 * Degrades rather than disappearing: with two such vendors it splits two ways.
 * A rule that vanishes when the pool is short tells the buyer nothing, while
 * "only 2 existing vendors bid" is the actual answer to their question.
 */
function threeLowestExisting(ranked: StrategyBid[]): StrategyProposal {
  const base = {
    key: "THREE_LOWEST_EXISTING" as const,
    label: "3 lowest · existing vendors",
    rule: "Even split across the 3 cheapest vendors we already work with",
  };
  const existing = ranked.filter((b) => !b.isNewToQuince).slice(0, 3);
  if (!existing.length) {
    return {
      ...base,
      split: {},
      unavailable: "Every vendor bidding this product is new to Quince.",
    };
  }
  return {
    ...base,
    split: evenSplit(existing.map((b) => b.vendorId)),
    unavailable: null,
  };
}

/**
 * Equal split across every bidder outside China — "what does de-risking cost?"
 *
 * Every non-China bidder, not the cheapest few: the question is what happens if
 * China is off the table, and dropping the expensive ones would understate it.
 * A vendor with no declared region is EXCLUDED — treating unknown as non-China
 * would overstate the de-risk, and the same conservative choice is made in
 * `cooBreakdown()`, which reports undeclared dollars separately rather than
 * letting them dilute a share.
 */
function equalNonChina(ranked: StrategyBid[]): StrategyProposal {
  const base = {
    key: "EQUAL_NON_CHINA" as const,
    label: "Equal split · non-China",
    rule: "Even split across every bidder outside China",
  };
  const pool = ranked.filter((b) => b.cooRegion && b.cooRegion !== CHINA);
  if (!pool.length) {
    return {
      ...base,
      split: {},
      unavailable: "No vendor outside China bid this product.",
    };
  }
  return {
    ...base,
    split: evenSplit(pool.map((b) => b.vendorId)),
    unavailable: null,
  };
}

/**
 * The configured split between the best current supplier and the best new
 * vendor — carried over from scenario 3, the one benchmark that was already an
 * allocation rule rather than a price.
 *
 * `isCurrentSupplier` (makes this product today) and `isNewToQuince` (new to
 * the company) are different axes, so a vendor can be neither — an existing
 * Quince vendor who does not currently make this style. Such a vendor is not
 * eligible for either side of this particular rule.
 */
function incumbentNewRatio(
  ranked: StrategyBid[],
  ratio: { incumbent: number; new: number },
): StrategyProposal {
  const base = {
    key: "INCUMBENT_NEW_RATIO" as const,
    label: `${Math.round(ratio.incumbent * 100)}/${Math.round(ratio.new * 100)} · incumbent / new`,
    rule: "Split between the best current supplier and the best new vendor",
  };
  const incumbent = ranked.find((b) => b.isCurrentSupplier);
  const fresh = ranked.find((b) => b.isNewToQuince);

  if (!incumbent || !fresh) {
    return {
      ...base,
      split: {},
      unavailable: !incumbent
        ? "No current supplier of this product bid it."
        : "No new vendor bid this product.",
    };
  }

  // Rounded to whole percent so the pair always totals exactly 100 — the
  // incumbent absorbs the rounding, being the larger share by construction.
  const newPct = Math.round(ratio.new * 100);
  return {
    ...base,
    split: {
      [fresh.vendorId]: newPct,
      [incumbent.vendorId]: 100 - newPct,
    },
    unavailable: null,
  };
}

/**
 * Award value grouped by sourcing region.
 *
 * INFORMATIONAL ONLY — no cap, no range, no breach. A per-product cap was
 * never coherent: China's 30% ceiling is a property of the WAVE, and one
 * product is a single contributor to it. The real guardrails live on Wave
 * Insights, computed by `cooBreakdown()` over every committed row.
 *
 * `share` is a FRACTION (0..1), matching `percent()` in lib/format and the
 * guardrail shares — deliberately NOT the 0-100 scale `awardPct` uses.
 */
export type RegionSplit = {
  region: string;
  dollars: number;
  units: number;
  /** Share of allocated VALUE, 0..1. Zero when nothing is allocated. */
  share: number;
  /** No vendor from this region bid the product — distinct from bid-but-0%. */
  noBids: boolean;
};

/** The five sourcing regions, in the order every screen shows them. */
export const REGION_ORDER = ["CHINA", "ISC", "SEA", "AMERICAS", "EMEA"];

const UNDECLARED = "Undeclared";

export function regionSplit(
  lines: { cooRegion: string | null; awardedDollars: number; awardedUnits: number }[],
  bidRegions: (string | null)[],
): RegionSplit[] {
  const dollars = new Map<string, number>();
  const units = new Map<string, number>();
  for (const l of lines) {
    const key = l.cooRegion ?? UNDECLARED;
    dollars.set(key, (dollars.get(key) ?? 0) + l.awardedDollars);
    units.set(key, (units.get(key) ?? 0) + l.awardedUnits);
  }

  const total = [...dollars.values()].reduce((s, v) => s + v, 0);
  const bid = new Set(bidRegions.map((r) => r ?? UNDECLARED));

  // Always all five, named, in a stable order. A region nobody bid still shows
  // as "no bids" — which is the honest reason it is at zero, and is why we do
  // not group into "Other": that would hide which region you are shifting into.
  const rows: RegionSplit[] = REGION_ORDER.map((region) => ({
    region,
    dollars: dollars.get(region) ?? 0,
    units: units.get(region) ?? 0,
    share: total > 0 ? (dollars.get(region) ?? 0) / total : 0,
    noBids: !bid.has(region),
  }));

  // A vendor with no declared COO is carried VISIBLY rather than dropped —
  // silently omitting them would make the shares sum to less than 100% with no
  // explanation on screen.
  if (bid.has(UNDECLARED) || (dollars.get(UNDECLARED) ?? 0) > 0) {
    rows.push({
      region: UNDECLARED,
      dollars: dollars.get(UNDECLARED) ?? 0,
      units: units.get(UNDECLARED) ?? 0,
      share: total > 0 ? (dollars.get(UNDECLARED) ?? 0) / total : 0,
      noBids: false,
    });
  }

  return rows;
}

/**
 * A strategy the user named and saved, as it comes off the wire.
 *
 * `split` is the snapshot. Nothing derived is stored — savings, blended cost
 * and the region mix are recomputed by running this split through
 * `allocate()`, so a figure refreshes when a vendor revises their bid while
 * the split stays exactly as saved.
 */
export type SavedStrategy = {
  id: string;
  name: string;
  comment: string | null;
  split: Record<string, number>;
  createdAt: string;
};

/**
 * Does this split match what is currently in the inputs?
 *
 * Drives the `current` chip, which has to work for a built-in rule AND a saved
 * strategy — the point of the chip is "you are looking at this one", and which
 * kind it is does not matter.
 *
 * Compares over the UNION of both sides' vendors, treating a missing vendor as
 * 0: a split of `{a: 100}` and inputs of `{a: 100, b: 0}` are the same
 * allocation, and an exact key-set comparison would call them different. A
 * tolerance of 0.005 matches `allocate()`'s own validity check, since award %
 * is stored to 2dp and a typed "33.33" must not fail against a stored 33.33.
 */
export function splitMatches(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const vendorIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of vendorIds) {
    if (Math.abs((a[id] ?? 0) - (b[id] ?? 0)) >= 0.005) return false;
  }
  // Two empty splits are not a "match" — nothing is allocated, so no card
  // should claim to be current.
  return [...vendorIds].some((id) => (a[id] ?? 0) > 0);
}

/**
 * Award % as typed (strings, only what the user changed) to a numeric split.
 *
 * Zeroes are DROPPED, so the result compares equal to a stored split that
 * simply omits the vendors it gave nothing to.
 */
export function splitFromInputs(
  pct: Record<string, string | number | undefined>,
): Record<string, number> {
  const split: Record<string, number> = {};
  for (const [vendorId, raw] of Object.entries(pct)) {
    const value = Number(raw ?? 0) || 0;
    if (value > 0) split[vendorId] = value;
  }
  return split;
}

/** Totals to exactly 100 within allocate()'s tolerance. */
export function splitTotalsHundred(split: Record<string, number>): boolean {
  const total = Object.values(split).reduce((s, v) => s + v, 0);
  return Math.abs(total - 100) < 0.005;
}
