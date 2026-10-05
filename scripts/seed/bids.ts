import type { PrismaClient, Template } from "@prisma/client";
import {
  WHOLE_STYLE_KEY,
  grainGroups,
  variationKeyOf,
  type Grain,
} from "../../src/domain/grain";
import { computeCost } from "../../src/domain/cost";
import { weightedBaseline } from "../../src/domain/award";
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

  /** Rotates the seeded bid statuses deterministically. */
  let bidSeq = 0;

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
        /**
         * OWNERS VARY BY CATEGORY (H5).
         *
         * Every seeded RFP carried the same pair, so the sourcing-partner
         * and GM filters had exactly one option each and could not be
         * demoed at all. Bedding and bottoms are genuinely different desks.
         */
        sourcingPartner: label.startsWith("Bedding")
          ? "Tony Alvarez"
          : "Priya Raman",
        gm: label.startsWith("Bedding") ? "Jackie Chen" : "Marcus Webb",
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

    /**
     * BID AT THE PRODUCT'S OWN GRAIN.
     *
     * The seed used to nominate and quote every product WHOLE, on the
     * reasoning that per-variation nomination is a buyer action. True, but
     * it left 19 quote rows sitting style-level on SIZE-grain products — so
     * the vendor form offered "quote this whole product" for a product
     * Quince had configured to bid per size, and `pricedVariations` was
     * empty on all 82 styles. Phase 2a has nothing to demo in that state.
     *
     * grainGroups() returns exactly ONE group at STYLE grain, so the
     * style-level product is the degenerate case of this same code path
     * rather than a branch.
     */
    const styleRow = await db.style.findUnique({
      where: { id: styleId },
      select: {
        variationLevel: true,
        variations: {
          select: {
            id: true,
            size: true,
            colour: true,
            colourwayId: true,
            sizeSortOrder: true,
            baselineFob: true,
          },
          orderBy: [{ sizeSortOrder: "asc" }],
        },
      },
    });

    const groups = grainGroups(
      (styleRow?.variationLevel ?? "STYLE") as Grain,
      styleRow?.variations ?? [],
    );

    /**
     * The FOB each group is quoted at, relative to the style baseline. Each
     * group's own variations carry a real `baselineFob` (seeded per variation
     * in 1.5a), so a King genuinely costs more than a Twin instead of
     * carrying an invented offset. Weighted by nothing — the group's mean is
     * right here because every variation in a size group is that one size.
     */
    const groupBaseline = new Map<string, number>();
    for (const g of groups) {
      const own = (styleRow?.variations ?? []).filter((v) =>
        g.variationIds.includes(v.id),
      );
      const fobs = own
        .map((v) => (v.baselineFob === null ? null : Number(v.baselineFob)))
        .filter((n): n is number => n !== null && n > 0);
      groupBaseline.set(
        g.key,
        fobs.length ? fobs.reduce((a, b) => a + b, 0) / fobs.length : baseline,
      );
    }

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

      /**
       * NOMINATE ONE ROW PER BID GROUP.
       *
       * At STYLE grain that is a single row keyed '@STYLE' — identical to
       * what every pre-1.6 row means, so nothing about the style-level case
       * changes. At SIZE grain it is one row per size, which is what makes
       * the vendor form render a line per variant.
       */
      for (const g of groups) {
        const variationId = g.key === WHOLE_STYLE_KEY ? null : g.variationIds[0]!;
        /**
         * The key is variationKeyOf(variationId) — the VARIATION ID, not the
         * group's display key.
         *
         * grainGroups() keys groups by label ("Cal King") because that is
         * what the UI groups on; every ROUTE keys storage by
         * variationKeyOf(). Writing the label here made the quote route's
         * upsert miss its own row and INSERT A DUPLICATE on first save —
         * caught by a save landing a 6th row on a 5-size product.
         */
        const variationKey = variationKeyOf(variationId);
        await db.invitationStyle.upsert({
          where: {
            invitationId_styleId_variationKey: {
              invitationId: invitation.id,
              styleId,
              variationKey,
            },
          },
          create: {
            invitationId: invitation.id,
            styleId,
            variationId,
            variationKey,
          },
          update: {},
        });
      }

      /**
       * THE BID STATUS. A handful of stages, not the whole ladder.
       *
       * Akshay: "don't over-engineer… don't spend so many tokens on giving
       * the full ladder." So this rotates through six states that between
       * them exercise every distinct shape the UI has to render: a vendor
       * waiting on Quince, a vendor who owes work, a repeatable
       * negotiation, a closed win and a closed loss.
       *
       * Deterministic by index, so a reseed produces the same demo.
       */
      const SEEDED_STATUSES = [
        "INITIAL_IN_REVIEW",
        "INITIAL_CLEARED",
        "FULL_IN_REVIEW",
        "IN_NEGOTIATION",
        "BID_ACCEPTED",
        "NOT_PROCEEDING",
      ] as const;
      const bidStatus = SEEDED_STATUSES[bidSeq % SEEDED_STATUSES.length];
      bidSeq += 1;

      await db.productBid.upsert({
        where: {
          invitationId_styleId: { invitationId: invitation.id, styleId },
        },
        create: {
          invitationId: invitation.id,
          styleId,
          status: bidStatus,
          statusNote:
            bidStatus === "IN_NEGOTIATION"
              ? "Materials look high against our target — can you revisit?"
              : bidStatus === "NOT_PROCEEDING"
                ? "Thank you for quoting. We are not proceeding on this product."
                : null,
          statusChangedBy: "Tony Alvarez",
        },
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

      /**
       * ONE QUOTE PER BID GROUP, each at its OWN price.
       *
       * The breakdown and the commercial terms are shared — labour rate and
       * SAM do not change by size — but the FOB and the group's own buckets
       * are scaled by that group's real baseline, so the five sizes come
       * back as five different prices rather than the same number repeated.
       * Repeating one price across variants is the bug that made the vendor
       * form show "$21.98" five times in 1.6d.
       *
       * The row the rest of the seed reports on is the FIRST group's, which
       * at STYLE grain is the only one.
       */
      const groupQuotes: { id: string; fob: number }[] = [];
      for (const g of groups) {
        /**
         * A SMALL PER-VENDOR, PER-SIZE SPREAD (±4%).
         *
         * Scaling every vendor by the SAME size ratio meant a vendor's rank
         * never changed between sizes: the cheapest on Twin was always the
         * cheapest on King, so "apply Lowest bid to all variations" put one
         * vendor on every size and N5's whole point — the cheapest on Twin
         * need not be the cheapest on King — could never be seen. Real
         * vendors price size runs differently (fabric width, cutting yield).
         *
         * Deterministic (the seeded RNG), and applied to FOB and every bucket
         * by the same factor, so buckets still sum to FOB exactly. Seeded
         * AWARDS are computed from the style-level split and are unaffected,
         * so China share does not move.
         */
        // Derived from a HASH of vendor + size, NOT drawn from `next()`.
        // Drawing from the shared RNG shifted every later draw, so different
        // vendors bid downstream and the wave total moved $60.9M -> $59.2M.
        // A hash leaves the main sequence — and every demo figure — untouched.
        const spread =
          g.key === WHOLE_STYLE_KEY ? 1 : 0.96 + 0.08 * hashUnit(`${vendor.vendorCode}|${styleId}|${g.key}`);
        const scale = ((groupBaseline.get(g.key) ?? baseline) / baseline) * spread;
        const gFob = round(line.fob * scale, 4);
        const gBuckets = Object.fromEntries(
          Object.entries(line.buckets).map(([k, v]) => [
            k,
            round((v as number) * scale, 4),
          ]),
        );
        const variationId = g.key === WHOLE_STYLE_KEY ? null : g.variationIds[0]!;

        const gq = await db.quote.create({
          data: {
            invitationId: invitation.id,
            styleId,
            vendorId: vendor.id,
            variationId,
            // variationKeyOf, not the group label — see the note above.
            variationKey: variationKeyOf(variationId),
            round: 1,
            status: "SUBMITTED",
            submittedAt: new Date("2026-09-20"),
            values: {
              ...line.values,
              maxVolumeCapacity: terms.maxVolumeCapacity,
              productionLeadTime: terms.productionLeadTime,
              moq: terms.moq,
            } as never,
            bucketTotals: gBuckets as never,
            fob: gFob,
            // DDP is declared PER PRODUCT, so every group carries the same
            // fees. The route's fan-out keeps them in step after an edit.
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
        groupQuotes.push({ id: gq.id, fob: gFob });
      }

      /**
       * The wave's arithmetic stays at STYLE level.
       *
       * `bids` feeds allocation, Best Cost and the guardrails, and those are
       * style-level by decision (D2 puts 100% per variation, but Phase 3 is
       * where award moves). Pushing one entry per GROUP here would multiply
       * every wave total by the variation count — the row-vs-product bug
       * that has already been found in seven places.
       */
      bids.push({
        style,
        vendor,
        fob: round(line.fob, 4),
        bestCost: cost.bestCost,
        basis: cost.bestCostBasis,
        quoteId: groupQuotes[0]!.id,
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

  /**
   * AWARDS ARE PER VARIATION — decision N1, 5 Oct.
   *
   * The style-level split chosen above (tuned so China opens just under 30%)
   * is applied to EVERY variation group of the style: same vendors, same
   * percentages, so each group totals exactly 100 on its own (D2).
   *
   * What differs per group is VOLUME and PRICE:
   *  - units are the group's own share of plan units, never the style's whole
   *    volume. Handing every group `style.planUnits` is the double-count the
   *    plan warns about — vendor spend would inflate ~5x straight through the
   *    $20M cap;
   *  - the cost is the style's Best Cost scaled by the group's own baseline,
   *    the same ratio the per-variation quotes were seeded with, so a King
   *    award costs more than a Twin one, as its quote does.
   *
   * A STYLE-grained product is one group with variationId null — the same
   * path, not a branch.
   */
  const variationsByStyle = new Map<
    string,
    { grain: Grain; variations: { id: string; size: string | null; colour: string | null; colourwayId: string | null; sizeSortOrder: number | null; planUnits: number; baselineFob: number }[] }
  >();
  for (const styleId of new Set(allocations.map((a) => a.styleId))) {
    const row = await db.style.findUnique({
      where: { id: styleId },
      select: {
        variationLevel: true,
        variations: {
          select: {
            id: true, size: true, colour: true, colourwayId: true,
            sizeSortOrder: true, planUnits: true, baselineFob: true,
          },
          orderBy: [{ sizeSortOrder: "asc" }],
        },
      },
    });
    variationsByStyle.set(styleId, {
      grain: (row?.variationLevel ?? "STYLE") as Grain,
      variations: (row?.variations ?? []).map((v) => ({
        ...v,
        planUnits: v.planUnits ?? 0,
        baselineFob: v.baselineFob === null ? 0 : Number(v.baselineFob),
      })),
    });
  }

  const awardRows: {
    region: string | null;
    dollars: number;
  }[] = [];

  for (const a of allocations) {
    const status = styleStatuses.get(a.styleId) ?? "AWARDED";
    const info = variationsByStyle.get(a.styleId)!;
    const groups = grainGroups(info.grain, info.variations);

    // The style's own reference baseline, weighted the same way the groups'
    // are, so the scale factors average to 1 across the style's volume.
    const styleBase = weightedBaseline(
      info.variations.map((v) => ({ baseline: v.baselineFob, planUnits: v.planUnits })),
    );
    const styleUnits = info.variations.reduce((sum, v) => sum + v.planUnits, 0);

    for (const g of groups) {
      const own = info.variations.filter((v) => g.variationIds.includes(v.id));
      const isWhole = g.key === WHOLE_STYLE_KEY;

      // Whole product: keep the allocation exactly as computed, so a
      // STYLE-grained style is byte-identical to before this change.
      const groupUnits = isWhole
        ? a.units
        : Math.round(
            a.units *
              (styleUnits
                ? own.reduce((sum, v) => sum + v.planUnits, 0) / styleUnits
                : 0),
          );
      const groupBase = weightedBaseline(
        own.map((v) => ({ baseline: v.baselineFob, planUnits: v.planUnits })),
      );
      const scale = !isWhole && styleBase > 0 && groupBase > 0 ? groupBase / styleBase : 1;
      const bestCost = round(a.bestCost * scale, 4);
      const dollars = isWhole ? a.dollars : round(groupUnits * bestCost, 2);
      // Savings per unit is (baseline - bestCost); both sides scale by the
      // same group ratio, so the per-unit saving scales with them.
      const savingsPerUnit = a.units ? a.savings / a.units : 0;
      const savings = isWhole
        ? a.savings
        : round(groupUnits * savingsPerUnit * scale, 2);

      const variationId = isWhole ? null : g.variationIds[0]!;

      await db.award.create({
        data: {
          waveId: wave.id,
          styleId: a.styleId,
          vendorId: a.vendorId,
          variationId,
          variationKey: variationKeyOf(variationId),
          awardPct: a.pct,
          bestCost,
          bestCostBasis: a.basis,
          awardedUnits: groupUnits,
          awardedDollars: dollars,
          savingsDollars: savings,
          status,
          // Only a true award carries the stamp — the other two have not been
          // awarded, and dating them would be a lie the UI would repeat.
          ...(status === "AWARDED"
            ? { awardedAt: new Date("2026-09-25"), awardedBy: "Jackie Chen" }
            : {}),
          comment: COMMENT[status],
        },
      });
      awardRows.push({ region: a.region, dollars });
    }
  }

  const total = awardRows.reduce((s, a) => s + a.dollars, 0);
  const china = awardRows
    .filter((a) => a.region === "CHINA")
    .reduce((s, a) => s + a.dollars, 0);

  step(
    `${awardRows.length} award rows (${allocations.length} style splits) on ${toAllocate.length} styles · ` +
      `$${(total / 1e6).toFixed(1)}M placed · China ${((china / total) * 100).toFixed(1)}%`,
  );

  // A DRAFT RFP with no invitations, so the nomination UI has something to
  // demo on. Every seeded RFP is ISSUED because they carry bids, which left
  // the Vendors tab's draft branch — checkboxes, variation picking, the
  // whole nomination flow — unreachable without hand-editing the database.
  const draftStyles = chosen.filter((s) => s.division === "Home").slice(0, 6);
  if (draftStyles.length) {
    const draftTemplate = templates.percale;
    if (draftTemplate) {
      await db.rfp.create({
        data: {
          waveId: wave.id,
          templateId: draftTemplate.id,
          name: "Home Bedding — Wave 3 (draft)",
          status: "DRAFT",
          dueDate: new Date("2026-12-01"),
          instructions:
            "All lead times must assume Q1 shipping. Quote in USD only. " +
            "Where a size run applies, quote each size.",
          // A third desk, so the filters have a value that is neither of the
          // issued RFPs' owners.
          sourcingPartner: "Dana Kowalski",
          gm: "Jackie Chen",
          styles: {
            create: draftStyles.map((s) => ({
              styleId: styleIds.get(s.styleNumber)!,
            })),
          },
        },
      });
    }
  }

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

/** A stable value in [0, 1) from a string — FNV-1a. Seed-only. */
function hashUnit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}
