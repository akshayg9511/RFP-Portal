import type { PrismaClient, Template } from "@prisma/client";
import { computeCost } from "../../src/domain/cost";
import { between, pick, round, step, type rng } from "./lib";
import type { StyleSeed } from "./styles";
import type { VendorSeed } from "./vendors";

/**
 * The wave, its RFPs, invitations, quotes and awards.
 *
 * Bids are generated, modelled on the real Wave 1 distribution: 36 of 41 real
 * styles bid 15-42% below baseline. A few deliberately land above baseline so
 * the "styles taking cost increases" block in Wave Insights has content.
 *
 * Only ~10 styles carry bids. The rest are quoted live in the demo.
 */

const BID_STYLE_COUNT = 10;
/** Of those, how many arrive already allocated and awarded. */
const PRE_ALLOCATED = 7;

/** Target for China's share of allocated award $ before the on-stage edit. */
const CHINA_TARGET_LOW = 0.28;
const CHINA_TARGET_HIGH = 0.3;

export async function seedBids(
  db: PrismaClient,
  next: ReturnType<typeof rng>,
  styles: StyleSeed[],
  vendors: VendorSeed[],
  templates: { percale: Template; ponte: Template },
  tariffLookup: (hts: string | null, iso: string) => number,
  logisticsLookup: (styleNumber: string, iso: string) => { ocean: number; air: number },
  styleIds: Map<string, string>,
  styleHts: Map<string, string | null>,
) {
  const wave = await db.wave.create({
    data: {
      name: "Wave 2 — FY26 Bedding & Bottoms",
      dueDate: new Date("2026-10-15"),
    },
  });

  // Choose bid styles: the largest by plan units, so award dollars are
  // meaningful, but spread across both categories.
  const withUnits = styles.filter((s) => (s.planUnits ?? 0) > 0 && s.baselineFob);
  const bedding = withUnits
    .filter((s) => s.division === "Home")
    .sort((a, b) => (b.planUnits ?? 0) - (a.planUnits ?? 0));
  const bottoms = withUnits
    .filter((s) => s.division !== "Home")
    .sort((a, b) => (b.planUnits ?? 0) - (a.planUnits ?? 0));

  // Order matters: the LAST three are left open for the live demo, and one of
  // them must be big enough that allocating it on stage visibly moves China's
  // share. So the second-largest bedding style is deliberately held back —
  // allocating a $0.1M style would move the guardrail by a fraction of a point
  // and the centrepiece moment would be invisible.
  const allocatedStyles = [...bedding.slice(0, 5), ...bottoms.slice(0, 2)];
  const openStyles = [bedding[5], bottoms[2], bottoms[3]].filter(Boolean);
  const chosen = [...allocatedStyles, ...openStyles].slice(0, BID_STYLE_COUNT);

  // One RFP per template, matching how templates resolve.
  const rfps = new Map<string, string>();
  for (const [key, template, label] of [
    ["Home", templates.percale, "Bedding — Percale R1"],
    ["Womens", templates.ponte, "Women's Bottoms — Ponte R1"],
  ] as const) {
    const styleList = chosen.filter((s) =>
      key === "Home" ? s.division === "Home" : s.division !== "Home",
    );
    if (!styleList.length) continue;

    const rfp = await db.rfp.create({
      data: {
        waveId: wave.id,
        templateId: template.id,
        name: label,
        status: "ISSUED",
        issuedAt: new Date("2026-09-08"),
        dueDate: new Date("2026-10-15"),
        instructions:
          "All lead times must assume Q1 shipping. Quote in USD only. " +
          "Where a size run applies, quote each size.",
        sourcingPartner: "Tony Alvarez",
        gm: "Jackie Chen",
        styles: {
          create: styleList.map((s) => ({ styleId: styleIds.get(s.styleNumber)! })),
        },
      },
    });
    rfps.set(key, rfp.id);
  }

  // Bidders per style: enough for the rank band (needs 3+), spread across
  // regions so no guardrail row is empty.
  const byRegion = new Map<string, VendorSeed[]>();
  for (const v of vendors) {
    const list = byRegion.get(v.cooRegion) ?? [];
    list.push(v);
    byRegion.set(v.cooRegion, list);
  }
  const regions = [...byRegion.keys()];

  type Bid = {
    style: StyleSeed;
    vendor: VendorSeed;
    fob: number;
    bestCost: number;
    basis: string;
    quoteId: string;
  };
  const bids: Bid[] = [];

  for (const [index, style] of chosen.entries()) {
    const rfpId = rfps.get(style.division === "Home" ? "Home" : "Womens");
    if (!rfpId) continue;

    const styleId = styleIds.get(style.styleNumber)!;
    const baseline = style.baselineFob!;

    // 3-6 bidders, one per region where possible so every region participates.
    const count = 3 + Math.floor(next() * 4);
    const picked: VendorSeed[] = [];
    const shuffled = [...regions].sort(() => next() - 0.5);
    for (const region of shuffled) {
      if (picked.length >= count) break;
      const pool = byRegion.get(region) ?? [];
      if (pool.length) picked.push(pick(next, pool));
    }
    while (picked.length < count) {
      const v = pick(next, vendors);
      if (!picked.some((p) => p.id === v.id)) picked.push(v);
    }

    // Two styles deliberately bid ABOVE baseline, so Wave Insights block 6
    // ("styles taking cost increases") has real content.
    const takesIncrease = index >= chosen.length - 2;

    for (const [i, vendor] of picked.entries()) {
      // Spread bids across all four competitiveness bands. The band is measured
      // against the CLEAN SHEET, which sits ~13% below baseline, so a bid needs
      // to be within a few points of it to read "strong". Stepping each
      // successive bidder down puts real bids in every band rather than
      // clustering them all at the top.
      const discount = takesIncrease
        ? between(next, -0.06, 0.02)
        : between(next, 0.13 - i * 0.035, 0.19 - i * 0.035);

      const fob = round(baseline * (1 - discount), 4);

      const iso = vendor.countryIso;
      const tariffRate = tariffLookup(styleHts.get(style.styleNumber) ?? null, iso);
      const { ocean, air } = logisticsLookup(style.styleNumber, iso);

      // Roughly a third of vendors quote DDP.
      const quotesDdp = next() < 0.35;
      const ddpOcean = quotesDdp ? round(fob * (1 + tariffRate) + ocean * 1.08, 4) : null;
      const ddpAir = quotesDdp ? round(fob * (1 + tariffRate) + air * 1.06, 4) : null;

      const cost = computeCost({
        fob,
        tariffRate,
        logisticsOcean: ocean,
        logisticsAir: air,
        ddpOcean,
        ddpAir,
      });

      const invitation = await db.invitation.upsert({
        where: { rfpId_vendorId: { rfpId, vendorId: vendor.id } },
        create: {
          rfpId,
          vendorId: vendor.id,
          status: "SUBMITTED",
          issuedAt: new Date("2026-09-08"),
        },
        update: {},
      });

      await db.invitationStyle.upsert({
        where: {
          invitationId_styleId: { invitationId: invitation.id, styleId },
        },
        create: { invitationId: invitation.id, styleId },
        update: {},
      });

      const buckets = scaleBuckets(style.buckets, fob);

      const quote = await db.quote.create({
        data: {
          invitationId: invitation.id,
          styleId,
          vendorId: vendor.id,
          round: 1,
          status: "SUBMITTED",
          submittedAt: new Date("2026-09-20"),
          values: { generated: true } as never,
          bucketTotals: buckets as never,
          fob,
          dutyType: quotesDdp ? "VDDP" : "QDDP",
          ddpCentral: ddpAir,
          maxVolumeCapacity: Math.round(between(next, 50_000, 400_000)),
          productionLeadTime: Math.round(between(next, 30, 75)),
          moq: Math.round(between(next, 500, 5000)),
        },
      });

      bids.push({
        style,
        vendor,
        fob,
        bestCost: cost.bestCost,
        basis: cost.bestCostBasis,
        quoteId: quote.id,
      });
    }
  }

  step(`${chosen.length} styles with ${bids.length} bids`);

  // Allocate the first 7 styles, leaving 3 open for the live demo. Allocation
  // is tuned so China opens just under its 30% cap.
  const toAllocate = chosen.slice(0, PRE_ALLOCATED);
  const allocations = allocateForChinaTarget(next, bids, toAllocate, styleIds);

  for (const a of allocations) {
    await db.award.create({
      data: {
        waveId: wave.id,
        styleId: a.styleId,
        vendorId: a.vendorId,
        awardPct: a.pct,
        bestCost: a.bestCost,
        bestCostBasis: a.basis,
        awardedUnits: a.units,
        awardedDollars: a.dollars,
        savingsDollars: a.savings,
        status: "AWARDED",
        awardedAt: new Date("2026-09-25"),
        awardedBy: "Jackie Chen",
        comment: "Awarded at review.",
      },
    });
  }

  const total = allocations.reduce((s, a) => s + a.dollars, 0);
  const china = allocations
    .filter((a) => a.region === "CHINA")
    .reduce((s, a) => s + a.dollars, 0);

  step(
    `${allocations.length} awards on ${toAllocate.length} styles · ` +
      `$${(total / 1e6).toFixed(1)}M placed · China ${((china / total) * 100).toFixed(1)}%`,
  );

  return { wave, chinaShare: china / total, allocated: toAllocate.length };
}

/**
 * Split a quoted FOB back across the style's bucket proportions, so bucket
 * flags have something real to compare.
 */
function scaleBuckets(
  buckets: Record<string, number>,
  fob: number,
): Record<string, number> {
  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  if (!total) return buckets;
  const factor = fob / total;
  return Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, round(v * factor, 4)]),
  );
}

type Allocation = {
  styleId: string;
  vendorId: string;
  region: string;
  pct: number;
  bestCost: number;
  basis: string;
  units: number;
  dollars: number;
  savings: number;
};

/**
 * Allocate each style across 2-3 vendors (multi-sourcing is the norm — 63% of
 * Wave 1 styles went to 2+ vendors), steering China's total share into the
 * 28-30% band so the on-stage allocation is what tips it over the cap.
 */
function allocateForChinaTarget(
  next: () => number,
  bids: {
    style: StyleSeed;
    vendor: VendorSeed;
    fob: number;
    bestCost: number;
    basis: string;
  }[],
  styles: StyleSeed[],
  styleIds: Map<string, string>,
): Allocation[] {
  const out: Allocation[] = [];

  // China's share is STEERED, not left to chance: it must open just under its
  // 30% cap so the allocation made on stage is what tips it. Styles are
  // allocated largest-first, and each one checks the running total — China gets
  // the bigger share while the wave is under target, the smaller share once it
  // is at target.
  const ordered = [...styles].sort(
    (a, b) =>
      (b.planUnits ?? 0) * (b.baselineFob ?? 0) -
      (a.planUnits ?? 0) * (a.baselineFob ?? 0),
  );
  const target = (CHINA_TARGET_LOW + CHINA_TARGET_HIGH) / 2;
  let runningTotal = 0;
  let runningChina = 0;

  for (const style of ordered) {
    const styleBids = bids
      .filter((b) => b.style.styleNumber === style.styleNumber)
      .sort((a, b) => a.bestCost - b.bestCost);
    if (!styleBids.length) continue;

    const china = styleBids.filter((b) => b.vendor.cooRegion === "CHINA");
    const other = styleBids.filter((b) => b.vendor.cooRegion !== "CHINA");

    // Multi-sourcing is the norm — 63% of Wave 1 styles went to 2+ vendors —
    // so every style splits.
    let splits: { bid: (typeof styleBids)[number]; pct: number }[];
    if (china.length && other.length) {
      // Look AHEAD, not behind: pick the China percentage that lands the
      // running total closest to target once THIS style is added. Reacting to
      // the share so far overshoots on the last big style.
      const styleValue =
        (style.planUnits ?? 0) * (china[0]?.bestCost ?? 0);
      const options = [0, 15, 30, 40, 55, 70];
      let bestPct = 0;
      let bestGap = Number.POSITIVE_INFINITY;
      for (const pct of options) {
        const projectedChina = runningChina + styleValue * (pct / 100);
        const projectedTotal = runningTotal + styleValue * 1.0;
        const gap = Math.abs(projectedChina / projectedTotal - target);
        if (gap < bestGap) {
          bestGap = gap;
          bestPct = pct;
        }
      }

      const remainder = 100 - bestPct;
      splits = bestPct === 0
        ? [
            { bid: other[0], pct: 60 },
            { bid: other[1] ?? other[0], pct: 40 },
          ]
        : [
            { bid: china[0], pct: bestPct },
            { bid: other[0], pct: Math.round(remainder * 0.65) },
            { bid: other[1] ?? other[0], pct: remainder - Math.round(remainder * 0.65) },
          ];
    } else if (styleBids.length >= 3) {
      splits = [
        { bid: styleBids[0], pct: 50 },
        { bid: styleBids[1], pct: 30 },
        { bid: styleBids[2], pct: 20 },
      ];
    } else {
      splits = [
        { bid: styleBids[0], pct: 60 },
        { bid: styleBids[1] ?? styleBids[0], pct: 40 },
      ];
    }

    // Collapse duplicates where a fallback reused the same vendor.
    const merged = new Map<string, { bid: (typeof styleBids)[number]; pct: number }>();
    for (const s of splits) {
      const existing = merged.get(s.bid.vendor.id);
      if (existing) existing.pct += s.pct;
      else merged.set(s.bid.vendor.id, { ...s });
    }
    splits = [...merged.values()];

    // The one hard validation: a style must total exactly 100%.
    const sum = splits.reduce((s, v) => s + v.pct, 0);
    if (sum !== 100) splits[0].pct += 100 - sum;

    const units = style.planUnits ?? 0;
    const baseline = style.baselineFob ?? 0;

    for (const s of splits) {
      const awardedUnits = Math.round(units * (s.pct / 100));
      const dollars = round(awardedUnits * s.bid.bestCost, 2);

      runningTotal += dollars;
      if (s.bid.vendor.cooRegion === "CHINA") runningChina += dollars;

      out.push({
        styleId: styleIds.get(style.styleNumber)!,
        vendorId: s.bid.vendor.id,
        region: s.bid.vendor.cooRegion,
        pct: s.pct,
        bestCost: s.bid.bestCost,
        basis: s.bid.basis,
        units: awardedUnits,
        dollars,
        savings: round(awardedUnits * (baseline - s.bid.bestCost), 2),
      });
    }
  }

  return out;
}

export { CHINA_TARGET_HIGH, CHINA_TARGET_LOW };
