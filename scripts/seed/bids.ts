import type { PrismaClient, Template } from "@prisma/client";
import { computeCost } from "../../src/domain/cost";
import { between, pick, round, step, type rng } from "./lib";
import { buildLineItems, floorOverhead, type TemplateSpec } from "./lineItems";
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

  // The form's own spec, read from each template definition so the seeded line
  // items land on the keys the form will render.
  const specFor = new Map<string, TemplateSpec>();
  for (const [key, template] of [
    ["Home", templates.percale],
    ["Womens", templates.ponte],
  ] as const) {
    const def = template.definition as unknown as {
      craftingFormula: TemplateSpec["craftingFormula"];
      materialFormula: TemplateSpec["materialFormula"];
      sections: { key: string; lines: { key: string; derived?: boolean; inputType: string }[] }[];
    };
    const keysOf = (sectionKey: string) =>
      (def.sections.find((x) => x.key === sectionKey)?.lines ?? [])
        .filter((l) => !l.derived && l.inputType === "currency")
        .map((l) => l.key);

    specFor.set(key, {
      craftingFormula: def.craftingFormula,
      materialFormula: def.materialFormula,
      trimKeys: keysOf("TRIM_HARDWARE"),
      packagingKeys: keysOf("PACKAGING"),
    });
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

    // 3-6 bidders. Regions are weighted to reflect where sourcing actually
    // happens — an even shuffle gave Americas and EMEA the same footprint as
    // China, which put Americas at 42% of the wave and made every floor look
    // met. The floors exist precisely because those regions are thin.
    const count = 3 + Math.floor(next() * 4);
    const picked: VendorSeed[] = [];
    const weighted: string[] = [];
    for (const region of regions) {
      const weight =
        region === "CHINA" ? 4 : region === "ISC" ? 3 : region === "SEA" ? 3 : 1;
      for (let w = 0; w < weight; w++) weighted.push(region);
    }
    // GUARANTEE THREE DISTINCT REGIONS FIRST, then fill by weight.
    //
    // Weighted sampling alone gives no breadth guarantee, and on the two styles
    // that carry two-thirds of the wave it drew only China and ISC. With China
    // held near its 29% target every remaining dollar then had nowhere to go
    // but ISC, which opened the wave at 55% against a 30% cap — a guardrail
    // already deep red before anyone touches it, which is exactly what the
    // guardrail design says gets ignored.
    //
    // This is a BIDDER POOL fix, not an allocation fix: no split of a two-region
    // shortlist can produce a three-region outcome. Weighting still decides who
    // wins, so China and ISC remain the heavyweights.
    //
    // CHINA ALWAYS BIDS. China is the incumbent sourcing base — it is not
    // plausible that it sits out a style, and mechanically a style with no
    // China bidder cannot contribute to China's share. With the largest style
    // in the wave drawn without China, the wave could not reach its 28-30%
    // pre-tip target no matter how the rest was split, because the remaining
    // styles were already at China's 70% per-style ceiling.
    const seedRegions = [
      "CHINA",
      ...[...regions].filter((r) => r !== "CHINA").sort(() => next() - 0.5),
    ].slice(0, 3);
    for (const region of seedRegions) {
      const pool = byRegion.get(region) ?? [];
      if (!pool.length) continue;
      const candidate = pick(next, pool);
      if (!picked.some((p) => p.id === candidate.id)) picked.push(candidate);
    }

    let guard = 0;
    while (picked.length < count && weighted.length && guard++ < 50) {
      const region = pick(next, weighted);
      const pool = byRegion.get(region) ?? [];
      if (!pool.length) continue;
      const candidate = pick(next, pool);
      if (!picked.some((p) => p.id === candidate.id)) picked.push(candidate);
    }
    while (picked.length < count) {
      const v = pick(next, vendors);
      if (!picked.some((p) => p.id === v.id)) picked.push(v);
    }

    // Two ALLOCATED styles deliberately come in above baseline landed, so Wave
    // Insights block 6 ("styles taking cost increases") — named by Tony as
    // something he needs and absent from the current workbook — has real
    // content. It must be measured against baseline LANDED, since that is what
    // Best Cost is compared to; baseline landed runs 37-160% above FOB, so a
    // bid merely above baseline FOB still shows a saving.
    const takesIncrease = index === 3 || index === 4;

    for (const [i, vendor] of picked.entries()) {
      // Spread bids across all four competitiveness bands. The band is measured
      // against the CLEAN SHEET, which sits ~13% below baseline, so a bid needs
      // to be within a few points of it to read "strong". Stepping each
      // successive bidder down puts real bids in every band rather than
      // clustering them all at the top.
      // A style taking an increase bids ABOVE baseline landed, which means a
      // large negative discount against FOB — the landed cushion is wide.
      const landedRatio = (style.baselineLanded ?? baseline) / baseline;
      const discount = takesIncrease
        ? between(next, -(landedRatio - 1) - 0.08, -(landedRatio - 1) - 0.02)
        : between(next, 0.13 - i * 0.035, 0.19 - i * 0.035);

      const fob = round(baseline * (1 - discount), 4);

      const iso = vendor.countryIso;
      const tariffRate = tariffLookup(styleHts.get(style.styleNumber) ?? null, iso);
      const { ocean, air } = logisticsLookup(style.styleNumber, iso);

      // Roughly a third of vendors quote DDP.
      //
      // DDP is quoted per MODE, and the three US destinations are a second axis
      // WITHIN each mode — six numbers. The destination spread is small (a few
      // percent) because it is inland freight on top of the same import, but it
      // is real, and Best Cost takes the HIGHEST destination in each mode. West
      // is cheapest (nearest the port of entry), East dearest.
      const quotesDdp = next() < 0.35;

      // Inland delivery, West/Central/East. This is a FREIGHT cost, so it is
      // added to the freight component — not applied as a percentage of the
      // whole landed value. Scaling all of landed by 4.5% is dollars on a
      // duty-inclusive FOB and swamped every freight saving, which is what
      // made DDP structurally unable to win.
      const inlandByDest = [0.0, 0.14, 0.31]; // per unit, USD

      // A vendor's own freight is not automatically dearer than ours. Some
      // consolidate and genuinely beat the Quince blend; others price in a
      // margin on freight and lose. Multiplying landed cost by a fixed >1
      // factor made DDP structurally unable to win, so min() never picked it
      // and the basis display was dead code — the comparison the Playground
      // exists to make visible would never have fired on stage.
      //
      // The factor straddles 1.0. Applied to the FREIGHT component only, since
      // duty is duty whoever pays it.
      // Independent per mode: a vendor consolidating ocean containers can beat
      // our ocean rate while still paying retail for air, or the reverse. One
      // shared factor moved both sides together and DDP could never close the
      // inland-delivery gap, so min() never picked it.
      const oceanFactor = between(next, 0.70, 1.15);
      const airFactor = between(next, 0.72, 1.15);
      const ddpOceanBase = quotesDdp
        ? fob * (1 + tariffRate) + ocean * oceanFactor
        : null;
      const ddpAirBase = quotesDdp
        ? fob * (1 + tariffRate) + air * airFactor
        : null;

      const ddpOceanByDest = ddpOceanBase
        ? inlandByDest.map((d) => round(ddpOceanBase + d, 4))
        : null;
      const ddpAirByDest = ddpAirBase
        ? inlandByDest.map((d) => round(ddpAirBase + d, 4))
        : null;

      // What Best Cost compares against: the worst destination in each mode, so
      // a DDP bid wins only if it beats the Quince blend everywhere.
      const ddpOcean = ddpOceanByDest ? Math.max(...ddpOceanByDest) : null;
      const ddpAir = ddpAirByDest ? Math.max(...ddpAirByDest) : null;


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

      // Real line items, not a marker. A seeded quote must open as a filled
      // sheet: storing only a total meant the form had nothing to populate
      // while the dashboard showed a price.
      const spec = specFor.get(style.division === "Home" ? "Home" : "Womens")!;
      const scaled = floorOverhead(
        scaleBuckets(style.buckets, fob) as never,
        next,
      );
      const line = buildLineItems(scaled, spec, next);

      // Best Cost derives from the FOB THAT IS STORED, not the one the bid
      // started as — rounding through the line items can move it by a cent,
      // and two figures for one bid is the defect this whole change removes.
      const cost = computeCost({
        fob: round(line.fob, 4),
        tariffRate,
        logisticsOcean: ocean,
        logisticsAir: air,
        ddpOcean,
        ddpAir,
      });

      /**
       * The commercial terms go in BOTH places, and that is deliberate.
       *
       * The typed columns are what the Playground and the vendor drill-down
       * query. The `values` blob is what the quote FORM reads and writes, since
       * the template puts these in its additionalInformation section like any
       * other line item. Seeding only the columns meant the form rendered the
       * fields empty and then wrote that emptiness back over them.
       *
       * Keys match the template (`additionalNotes`, not `notes`) — domain/terms
       * owns that rename.
       */
      const terms = {
        maxVolumeCapacity: Math.round(between(next, 50_000, 400_000)),
        productionLeadTime: Math.round(between(next, 30, 75)),
        moq: Math.round(between(next, 500, 5000)),
      };

      const quote = await db.quote.create({
        data: {
          invitationId: invitation.id,
          styleId,
          vendorId: vendor.id,
          round: 1,
          status: "SUBMITTED",
          submittedAt: new Date("2026-09-20"),
          values: {
            ...line.values,
            maxVolumeCapacity: terms.maxVolumeCapacity,
            productionLeadTime: terms.productionLeadTime,
            moq: terms.moq,
          } as never,
          bucketTotals: line.buckets as never,
          fob: round(line.fob, 4),
          dutyType: quotesDdp ? "VDDP" : "QDDP",
          // The unsuffixed trio is the OCEAN set (see schema comment).
          ddpWest: ddpOceanByDest?.[0] ?? null,
          ddpCentral: ddpOceanByDest?.[1] ?? null,
          ddpEast: ddpOceanByDest?.[2] ?? null,
          ddpWestAir: ddpAirByDest?.[0] ?? null,
          ddpCentralAir: ddpAirByDest?.[1] ?? null,
          ddpEastAir: ddpAirByDest?.[2] ?? null,
          maxVolumeCapacity: terms.maxVolumeCapacity,
          productionLeadTime: terms.productionLeadTime,
          moq: terms.moq,
        },
      });

      bids.push({
        style,
        vendor,
        fob: round(line.fob, 4),
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

  /**
   * A WAVE MID-FLIGHT, not a finished one. Every award row used to be AWARDED,
   * which left the Award Summary status column showing one value and the
   * §11.10 ladder — allocate -> review -> award — with nothing to demonstrate.
   *
   * The last two allocated styles are held back: one still being worked, one
   * handed to the reviewer. Status is per style, since a style's rows move
   * together.
   */
  const styleStatuses = new Map<string, string>();
  const styleIdsInOrder = [...new Set(allocations.map((a) => a.styleId))];
  styleIdsInOrder.forEach((styleId, i) => {
    const fromEnd = styleIdsInOrder.length - 1 - i;
    styleStatuses.set(
      styleId,
      fromEnd === 0 ? "ALLOCATED" : fromEnd === 1 ? "READY_FOR_REVIEW" : "AWARDED",
    );
  });

  const COMMENT: Record<string, string> = {
    AWARDED: "Awarded at review.",
    READY_FOR_REVIEW: "Split agreed with the category team — over to review.",
    ALLOCATED: "Holding at this split until Yantai confirms capacity.",
  };

  for (const a of allocations) {
    const status = styleStatuses.get(a.styleId) ?? "AWARDED";
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
        status,
        // Only a true award carries the stamp — the other two have not been
        // awarded, and dating them would be a lie the UI would repeat.
        ...(status === "AWARDED"
          ? { awardedAt: new Date("2026-09-25"), awardedBy: "Jackie Chen" }
          : {}),
        comment: COMMENT[status],
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
      // Project China's dollars and the style's TOTAL dollars separately. Both
      // used china[0].bestCost, which understates the total whenever China is
      // not the cheapest bidder — the style then looks smaller than it is and
      // China gets too small a share of it. Now that every style has three
      // regions bidding, China is frequently not the cheapest, and that bias
      // pulled the wave to 27.5% against a 28-30% target.
      const units = style.planUnits ?? 0;
      const chinaCost = china[0]?.bestCost ?? 0;
      const otherCost = other[0]?.bestCost ?? chinaCost;

      const options = [0, 15, 30, 40, 55, 70];
      let bestPct = 0;
      let bestGap = Number.POSITIVE_INFINITY;
      for (const pct of options) {
        const share = pct / 100;
        const chinaDollars = units * share * chinaCost;
        const otherDollars = units * (1 - share) * otherCost;
        const projectedChina = runningChina + chinaDollars;
        const projectedTotal = runningTotal + chinaDollars + otherDollars;

        // Only China is steered here. ISC lands around 31% — just over its own
        // cap — and that is LEFT ALONE deliberately: this lever cannot move it.
        // ISC's share comes from the non-China remainder, which is the same
        // whichever China percentage is chosen, so every attempt to steer both
        // from this one knob traded one breach for another (penalising ISC put
        // China at 35.7%). Fixing it properly means choosing the remainder's
        // vendors by region, which is allocation policy, not seed tuning.
        //
        // It is also arguably the more honest demo: Wave 1's real problem was
        // concentration, a wave with one region already over cap is what the
        // team actually faces, and the breach is clickable in Wave Insights.
        // China at 29.1% is still the one that tips on stage.
        const chinaShare = projectedTotal ? projectedChina / projectedTotal : 0;
        const gap = Math.abs(chinaShare - target);
        if (gap < bestGap) {
          bestGap = gap;
          bestPct = pct;
        }
      }

      const remainder = 100 - bestPct;

      // The non-China remainder used to go to the two CHEAPEST bidders whatever
      // their region, and those were consistently ISC — which opened the wave
      // at 54.9% against a 30% cap. A rail that is already deep red before
      // anyone touches it is the thing the guardrail design explicitly warns
      // about: it gets ignored within a week, and it steals the moment from
      // China actually tipping on stage.
      //
      // So prefer a SECOND REGION for the runner-up. Still cheapest-first
      // within that constraint — this changes who gets the smaller half, not
      // the principle that low cost wins.
      const pickOther = (exclude: string | null) => {
        const different = other.find(
          (b) => b.vendor.cooRegion && b.vendor.cooRegion !== exclude,
        );
        return different ?? other[1] ?? other[0];
      };

      const lead = other[0];
      const second = pickOther(lead?.vendor.cooRegion ?? null);

      // The remainder is SPLIT, never handed whole to one vendor. Two styles
      // carry $44.7M of this $61.7M wave, so a single style putting 70% on one
      // region sets that region's wave-wide share on its own — which is how ISC
      // opened at 54.9% against a 30% cap while every per-style split looked
      // reasonable. Splitting the remainder keeps any one style from deciding a
      // guardrail by itself.
      const third = other.find(
        (b) =>
          b !== lead &&
          b !== second &&
          b.vendor.cooRegion !== lead?.vendor.cooRegion &&
          b.vendor.cooRegion !== second?.vendor.cooRegion,
      );

      splits = bestPct === 0
        ? [
            { bid: lead, pct: 45 },
            { bid: second, pct: 35 },
            { bid: third ?? second, pct: 20 },
          ]
        : [
            { bid: china[0], pct: bestPct },
            { bid: lead, pct: Math.round(remainder * 0.55) },
            { bid: second, pct: remainder - Math.round(remainder * 0.55) },
          ];
    } else if (styleBids.length >= 3) {
      // Same reasoning: spread across regions where the bidders allow it.
      const lead = styleBids[0];
      const rest = styleBids.slice(1);
      const secondRegion =
        rest.find(
          (b) => b.vendor.cooRegion && b.vendor.cooRegion !== lead.vendor.cooRegion,
        ) ?? rest[0];
      const thirdRegion =
        rest.find(
          (b) =>
            b !== secondRegion &&
            b.vendor.cooRegion &&
            b.vendor.cooRegion !== lead.vendor.cooRegion &&
            b.vendor.cooRegion !== secondRegion.vendor.cooRegion,
        ) ?? rest.find((b) => b !== secondRegion) ?? secondRegion;

      splits = [
        { bid: lead, pct: 50 },
        { bid: secondRegion, pct: 30 },
        { bid: thirdRegion, pct: 20 },
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

    // Savings must compare LIKE WITH LIKE. Best Cost is a landed figure (FOB +
    // tariff + freight), so measuring it against a baseline FOB understates
    // every bid by the full freight and duty amount — inverted, it made a wave
    // of genuine savings read as a $8.3M cost increase. This is the Wave 1
    // -$37,038 error in the other direction, and the Build Doc forbids it
    // either way: a vendor FOB compares to baseline FOB, a landed figure to
    // baseline landed.
    const baselineLanded = style.baselineLanded ?? baseline;

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
        savings: round(awardedUnits * (baselineLanded - s.bid.bestCost), 2),
      });
    }
  }

  return out;
}

export { CHINA_TARGET_HIGH, CHINA_TARGET_LOW };
