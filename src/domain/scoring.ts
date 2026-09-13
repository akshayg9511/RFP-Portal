/**
 * Competitiveness, bucket flags and rank — the three signals a vendor sees.
 *
 * Designed to apply pressure without revealing Quince's position. What is NOT
 * returned matters as much as what is (Build Doc 8.2):
 *
 *   - never the clean sheet value, or any number that can be solved backwards
 *   - never another vendor's name or number
 *   - never a raw 0-100 score
 *   - never a blank where a signal would be
 *
 * Two of the three signals need no other bidders at all, which matters because
 * 134 of 534 Wave 1 styles had two or fewer bidders and 52 had exactly one.
 */

export type Band = "STRONG" | "COMPETITIVE" | "NEEDS_WORK" | "OFF_TARGET";

export type BandCutoffs = {
  strong: number;
  competitive: number;
  needsWork: number;
};

/** Held in Config so they retune against a real bid distribution. */
export const DEFAULT_CUTOFFS: BandCutoffs = {
  strong: 0.6,
  competitive: 0.35,
  needsWork: 0.1,
};

/**
 * Competitiveness band. Always available — it depends only on this vendor's
 * bid, the baseline and the clean sheet.
 *
 * Bands rather than a number, for two reasons. A linear 0-100 from baseline to
 * clean sheet clusters low, because the clean sheet is a floor vendors rarely
 * reach: on baseline $38 / clean sheet $24, a great bid at $29 reads 64 and an
 * excellent bid reads as a failing grade. And a precise score can be solved for
 * both endpoints in two attempts.
 *
 * `s` is internal and is NEVER returned.
 */
export function competitiveness(
  bidFob: number,
  baselineFob: number,
  cleanSheetFob: number,
  cutoffs: BandCutoffs = DEFAULT_CUTOFFS,
): Band | null {
  // No clean sheet means no band. Show "Clean sheet missing" rather than a
  // blank or a zero (Build Doc 10.2).
  if (!cleanSheetFob || baselineFob <= cleanSheetFob) return null;

  const s = (baselineFob - bidFob) / (baselineFob - cleanSheetFob);

  if (s >= cutoffs.strong) return "STRONG";
  if (s >= cutoffs.competitive) return "COMPETITIVE";
  if (s >= cutoffs.needsWork) return "NEEDS_WORK";
  return "OFF_TARGET";
}

export type BucketFlag = "ABOVE" | "IN_LINE" | "BELOW";

export type BucketFlagResult = {
  bucket: string;
  flag: BucketFlag;
};

/**
 * Per-bucket direction against the clean sheet's target for that bucket.
 *
 * Measured against the clean sheet rather than against other bids: it works on
 * every style, needs no peer data, and is more actionable for the vendor than
 * "above the other bids". Bands only — the clean sheet value is never exposed.
 */
export function bucketFlags(
  bidBuckets: Record<string, number>,
  cleanSheetBuckets: Record<string, number>,
  tolerance = 0.1,
): BucketFlagResult[] {
  return Object.entries(cleanSheetBuckets)
    .filter(([, target]) => target > 0)
    .map(([bucket, target]) => {
      const bid = bidBuckets[bucket] ?? 0;
      const delta = (bid - target) / target;

      return {
        bucket,
        flag:
          delta > tolerance ? "ABOVE" : delta < -tolerance ? "BELOW" : "IN_LINE",
      };
    });
}

export type RankBand = "TOP_TIER" | "MID_PACK" | "BACK_OF_PACK";

/**
 * Rank, banded with deliberate ties.
 *
 * Returns null below three bidders — with one or two, a rank identifies the
 * other vendor's position exactly. Below three the line is simply absent, and
 * the other two signals still fill the panel so there is never an empty state.
 */
export function rankBand(
  bidFob: number,
  allBidFobs: number[],
  minimumBidders = 3,
): { band: RankBand; totalBidders: number } | null {
  if (allBidFobs.length < minimumBidders) return null;

  const sorted = [...allBidFobs].sort((a, b) => a - b);
  const position = sorted.findIndex((f) => f >= bidFob);
  const percentile = position / (sorted.length - 1);

  return {
    band:
      percentile <= 0.33
        ? "TOP_TIER"
        : percentile <= 0.66
          ? "MID_PACK"
          : "BACK_OF_PACK",
    totalBidders: sorted.length,
  };
}

export type VendorSignals = {
  competitiveness: Band | null;
  buckets: BucketFlagResult[];
  rank: { band: RankBand; totalBidders: number } | null;
};

/**
 * Everything shown in the vendor's score panel. Note the return type carries no
 * costs, no percentages and no vendor names — only bands and directions, so
 * nothing here can be solved backwards.
 */
export function vendorSignals(input: {
  bidFob: number;
  bidBuckets: Record<string, number>;
  baselineFob: number;
  cleanSheetFob: number;
  cleanSheetBuckets: Record<string, number>;
  allBidFobs: number[];
  cutoffs?: BandCutoffs;
  bucketTolerance?: number;
}): VendorSignals {
  return {
    competitiveness: competitiveness(
      input.bidFob,
      input.baselineFob,
      input.cleanSheetFob,
      input.cutoffs,
    ),
    buckets: bucketFlags(
      input.bidBuckets,
      input.cleanSheetBuckets,
      input.bucketTolerance,
    ),
    rank: rankBand(input.bidFob, input.allBidFobs),
  };
}
