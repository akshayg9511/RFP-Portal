import { describe, expect, it } from "vitest";
import {
  bucketFlags,
  competitiveness,
  rankBand,
  vendorSignals,
} from "./scoring";

describe("competitiveness bands", () => {
  // The Build Doc's worked example: baseline $38, clean sheet $24, range $14.
  const baseline = 38;
  const cleanSheet = 24;

  it("matches the documented cutoffs", () => {
    expect(competitiveness(29.0, baseline, cleanSheet)).toBe("STRONG");
    expect(competitiveness(31.0, baseline, cleanSheet)).toBe("COMPETITIVE");
    expect(competitiveness(35.0, baseline, cleanSheet)).toBe("NEEDS_WORK");
    expect(competitiveness(37.0, baseline, cleanSheet)).toBe("OFF_TARGET");
  });

  it("puts a bid at the clean sheet in the top band", () => {
    expect(competitiveness(24, baseline, cleanSheet)).toBe("STRONG");
  });

  it("puts a bid at or above baseline in the bottom band", () => {
    expect(competitiveness(38, baseline, cleanSheet)).toBe("OFF_TARGET");
    expect(competitiveness(42, baseline, cleanSheet)).toBe("OFF_TARGET");
  });

  it("returns null without a clean sheet, rather than a misleading band", () => {
    // Shown as "Clean sheet missing", never as a blank or a zero.
    expect(competitiveness(30, baseline, 0)).toBeNull();
    expect(competitiveness(30, 20, 24)).toBeNull();
  });

  it("honours retuned cutoffs from config", () => {
    const strict = { strong: 0.9, competitive: 0.7, needsWork: 0.5 };
    expect(competitiveness(29, baseline, cleanSheet, strict)).toBe("NEEDS_WORK");
  });
});

describe("bucket flags", () => {
  const cleanSheet = { BASE_MATERIALS: 10, CRAFTING: 5, PACKAGING: 1 };

  it("flags direction against the clean sheet's bucket target", () => {
    const flags = bucketFlags(
      { BASE_MATERIALS: 13, CRAFTING: 5.1, PACKAGING: 0.8 },
      cleanSheet,
    );
    expect(flags.find((f) => f.bucket === "BASE_MATERIALS")!.flag).toBe("ABOVE");
    expect(flags.find((f) => f.bucket === "CRAFTING")!.flag).toBe("IN_LINE");
    expect(flags.find((f) => f.bucket === "PACKAGING")!.flag).toBe("BELOW");
  });

  it("treats a missing bucket as zero, which reads BELOW", () => {
    expect(bucketFlags({}, { CRAFTING: 5 })[0].flag).toBe("BELOW");
  });

  it("skips buckets the clean sheet does not target", () => {
    expect(bucketFlags({ X: 5 }, { X: 0 })).toHaveLength(0);
  });

  it("honours a retuned tolerance", () => {
    expect(bucketFlags({ A: 11 }, { A: 10 }, 0.25)[0].flag).toBe("IN_LINE");
    expect(bucketFlags({ A: 11 }, { A: 10 }, 0.05)[0].flag).toBe("ABOVE");
  });
});

describe("rank band", () => {
  it("is withheld below three bidders", () => {
    // With one or two, a rank identifies the other vendor's position exactly.
    expect(rankBand(10, [10])).toBeNull();
    expect(rankBand(10, [10, 12])).toBeNull();
  });

  it("appears at three", () => {
    const r = rankBand(10, [10, 11, 12]);
    expect(r).not.toBeNull();
    expect(r!.totalBidders).toBe(3);
    expect(r!.band).toBe("TOP_TIER");
  });

  it("bands by position, with deliberate ties", () => {
    const bids = [10, 11, 12, 13, 14, 15];
    expect(rankBand(10, bids)!.band).toBe("TOP_TIER");
    expect(rankBand(12, bids)!.band).toBe("MID_PACK");
    expect(rankBand(15, bids)!.band).toBe("BACK_OF_PACK");
  });
});

describe("vendorSignals — the whole panel", () => {
  const input = {
    bidFob: 30,
    bidBuckets: { BASE_MATERIALS: 18, CRAFTING: 8 },
    baselineFob: 38,
    cleanSheetFob: 24,
    cleanSheetBuckets: { BASE_MATERIALS: 15, CRAFTING: 8 },
    allBidFobs: [29, 30, 31, 33],
  };

  it("returns all three signals when there are enough bidders", () => {
    const s = vendorSignals(input);
    expect(s.competitiveness).toBe("COMPETITIVE");
    expect(s.rank!.band).toBe("MID_PACK");
    expect(s.buckets.find((b) => b.bucket === "BASE_MATERIALS")!.flag).toBe(
      "ABOVE",
    );
  });

  it("still fills the panel with one bidder — no empty state", () => {
    const s = vendorSignals({ ...input, allBidFobs: [30] });
    expect(s.rank).toBeNull();
    expect(s.competitiveness).not.toBeNull();
    expect(s.buckets.length).toBeGreaterThan(0);
  });

  it("leaks nothing that can be solved backwards", () => {
    // The contract: bands and directions only. No costs, no percentages, no
    // vendor names, no raw score.
    const s = vendorSignals(input);
    const serialised = JSON.stringify(s);
    expect(serialised).not.toContain("24"); // the clean sheet value
    expect(Object.keys(s).sort()).toEqual([
      "buckets",
      "competitiveness",
      "rank",
    ]);
    for (const bucket of s.buckets) {
      expect(Object.keys(bucket).sort()).toEqual(["bucket", "flag"]);
    }
  });
});
