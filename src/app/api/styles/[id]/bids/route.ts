import { db } from "@/lib/db";
import { handle, notFound, num, numOr } from "@/lib/api";
import { strategies } from "@/domain/strategies";
import { bucketFlags } from "@/domain/scoring";
import { resolveBestCost } from "@/lib/bestCost";
import { loadRateBook } from "@/lib/rateBook";
import { variationKeyOf } from "@/domain/grain";
import { awardGroups, VARIATION_SELECT } from "@/lib/variationGroups";

/**
 * @openapi
 * /api/styles/{id}/bids:
 *   get:
 *     summary: Everything the bid-comparison and award pages need, in one call
 *     description: >
 *       Fetched ONCE per product. Both pages then recompute the whole readout
 *       in the browser from domain/award on every keystroke — Architecture
 *       section 5, because a round trip per keystroke makes the centrepiece
 *       feel laggy and the demo moment dies.
 *
 *       Carries the per-vendor bucket split AND the line items behind it, so
 *       A4 can drill from a bucket total to its evidence without a second
 *       request. No longer carries wave award rows or guardrail config: a
 *       per-product cap was never coherent, so guardrails are wave-level only.
 *     responses:
 *       200: { description: Style, bids with bucket splits and line items, allocation, strategies }
 *       404: { description: No such style }
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    /**
     * WHICH VARIATION — decisions N1 / N2, 5 Oct.
     *
     * Awarding is per variation, so this page compares and allocates ONE
     * variation group at a time, chosen by a dropdown in the header. Omitted
     * means the first group, so the page never opens on "pick one first".
     *
     * Before this, quotes were read with NO variation filter, so a 5-size
     * product returned each vendor five times at five prices with nothing
     * saying which size — 30 rows for 6 vendors, measured on U-BEDD-138.
     */
    const requestedVariation = new URL(request.url).searchParams.get(
      "variationId",
    );

    const [rates, style, config] = await Promise.all([
      loadRateBook(),
      db.style.findUnique({
        where: { id },
        include: {
          /**
           * The FULL set, not just the hero. ~620 of the seeded images were
           * reachable from one drawer only, because every other route filtered
           * `isHero: true, take: 1` — so someone deciding an award, or pricing
           * the product, saw a single photograph.
           */
          images: {
            orderBy: { position: "asc" },
            select: { url: true, isHero: true },
          },
          colourways: {
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              images: { orderBy: { position: "asc" }, select: { url: true } },
            },
          },
          currentSuppliers: {
            where: { variationId: null },
            select: { vendorId: true },
          },
          variations: VARIATION_SELECT,
          quotes: {
            where: { status: "SUBMITTED" },
            select: {
              id: true,
              variationKey: true,
              fob: true,
              vendorId: true,
              dutyType: true,
              bucketTotals: true,
              // A4 drills from a bucket TOTAL down to the line items behind
              // it. Materials and Crafting come through a formula, so the
              // lines are evidence for the total, never the source of it.
              values: true,
              // Section 8 attributes. Never summed into FOB, but they decide an
              // award as much as price does — a cheaper vendor who cannot make
              // the volume is not cheaper.
              maxVolumeCapacity: true,
              productionLeadTime: true,
              moq: true,
              ddpWest: true,
              ddpCentral: true,
              ddpEast: true,
              ddpWestAir: true,
              ddpCentralAir: true,
              ddpEastAir: true,
              invitationId: true,
              // A4's bucket expand needs to know which line items belong to
              // which bucket, and the TEMPLATE is the only place that says.
              // Traversed the same way as api/quotes/[inv]/[style].
              invitation: {
                select: {
                  rfp: {
                    select: {
                      template: { select: { name: true, definition: true } },
                    },
                  },
                },
              },
              vendor: {
                select: {
                  id: true,
                  name: true,
                  vendorCode: true,
                  cooRegion: true,
                  countryIso: true,
                  isNewToQuince: true,
                },
              },
            },
          },
          awards: {
            select: {
              variationKey: true,
              vendorId: true,
              awardPct: true,
              status: true,
              comment: true,
            },
          },
        },
      }),
      db.config.findMany({
        where: {
          key: {
            in: [
              "scenarios.ratio",
              "bands.bucketFlag",
            ],
          },
        },
      }),
    ]);

    if (!style) return notFound(`Style ${id}`);

    /**
     * THE VARIATION GROUPS, at this product's grain — from the SAME helper
     * the award save uses, so the readout and the stored award can never
     * disagree about a group's volume or baseline.
     */
    const groups = awardGroups(style);

    const selected =
      groups.find((g) => g.variationId === requestedVariation) ?? groups[0]!;
    const selectedKey = selected.variationKey;

    /**
     * The should-cost target, per bucket, FOR THIS VARIATION. INTERNAL ONLY —
     * this route feeds procurement's screen; the vendor-facing route reduces
     * the same data to bands (Build Doc 8.2). Per-variation clean sheets exist
     * since 1.5a, so the target follows the dropdown exactly as the bids do.
     */
    const cleanSheetRows = await db.cleanSheet.findMany({
      where: {
        styleId: id,
        kind: "CLEAN_SHEET",
        variationId: selected.variationId,
      },
      select: { bucket: true, amount: true },
    });

    const cfg = new Map(config.map((c) => [c.key, c.value]));

    // Buckets can repeat per size, so sum rather than assign.
    const cleanSheetBuckets: Record<string, number> = {};
    for (const row of cleanSheetRows) {
      cleanSheetBuckets[row.bucket] =
        (cleanSheetBuckets[row.bucket] ?? 0) + (num(row.amount) ?? 0);
    }
    const cleanSheetFob = Object.values(cleanSheetBuckets).reduce(
      (a, b) => a + b,
      0,
    );

    // `bands.bucketFlag` has been seeded since F2 and read by nothing. It is
    // asymmetric ({above, below}); bucketFlags() takes one scalar, so use the
    // above-side as the tolerance and keep the config as the source.
    const flagCfg = (cfg.get("bands.bucketFlag") ?? {}) as {
      above?: number;
      below?: number;
    };
    const bucketTolerance =
      typeof flagCfg.above === "number" ? flagCfg.above : 0.1;
    const supplierIds = new Set(style.currentSuppliers.map((c) => c.vendorId));

    // ONE ROW PER VENDOR, for the selected variation only. This is the line
    // that ends the 30-rows-for-6-vendors defect.
    const quotesForGroup = style.quotes.filter(
      (q) => q.variationKey === selectedKey,
    );

    const bids = quotesForGroup
      .map((q) => {
        const cost = resolveBestCost(q, style, q.vendor, rates, selected.size);
        if (!cost) return null;
        return {
          quoteId: q.id,
          invitationId: q.invitationId,
          // Every bid says which variation it is for, so a row can never
          // again render without a size.
          variationId: selected.variationId,
          variationLabel: selected.label,
          vendorId: q.vendor.id,
          vendorName: q.vendor.name,
          vendorCode: q.vendor.vendorCode,
          cooRegion: q.vendor.cooRegion,
          countryIso: q.vendor.countryIso,
          isNewToQuince: q.vendor.isNewToQuince,
          isCurrentSupplier: supplierIds.has(q.vendor.id),
          dutyType: q.dutyType,
          fob: num(q.fob),
          /**
           * The STORED split, not a re-derivation — Materials and Crafting come
           * through a formula, so summing the raw money lines understates them.
           *
           * This has always been on the wire and the Playground threw it away:
           * its Bid type did not even declare the field, so answering "why is
           * this vendor cheaper" meant opening two RFP drawers and memorising
           * numbers.
           */
          bucketTotals: (q.bucketTotals ?? {}) as Record<string, number>,
          /**
           * The raw line inputs behind those totals, for A4's drill-down.
           * Shape is template-defined (`Quote.values`), so the screen renders
           * whatever keys are present rather than assuming a schema.
           */
          values: (q.values ?? {}) as Record<string, unknown>,
          maxVolumeCapacity: q.maxVolumeCapacity,
          productionLeadTime: q.productionLeadTime,
          moq: q.moq,
          bucketFlags: cleanSheetFob
            ? bucketFlags(
                (q.bucketTotals ?? {}) as Record<string, number>,
                cleanSheetBuckets,
                bucketTolerance,
              )
            : [],

          // The whole chain, not just the answer — the Playground shows which
          // side min() picked, and a reader should be able to see why.
          landedOcean: cost.landedOcean,
          landedAir: cost.landedAir,
          quinceBlend: cost.quinceBlend,
          ddpBlend: cost.ddpBlend,
          bestCost: cost.bestCost,
          bestCostBasis: cost.bestCostBasis,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.bestCost - b.bestCost);

    // Any quote will do — they share the RFP, hence the template.
    const template =
      style.quotes.find((q) => q.invitation?.rfp?.template)?.invitation?.rfp
        ?.template ?? null;



    const ratio = (cfg.get("scenarios.ratio") ?? {
      incumbent: 0.7,
      new: 0.3,
    }) as { incumbent: number; new: number };

    /**
     * `waveRows` USED to be fetched here, so the drawer's guardrail rail could
     * merge an unsaved edit against wave totals. Both are gone: guardrails are
     * a WAVE-level property (Wave Insights owns them), and a per-product cap
     * was never coherent — China's 30% ceiling is a property of the wave, and
     * one product is a single contributor to it.
     *
     * This also retires a live trap: `guardrailStrip` dropped committed rows by
     * `styleId`, not `styleId|vendorId`, so a partial pending set silently
     * deleted the rest of the style from the totals and China read LOW.
     */

    return {
      style: {
        id: style.id,
        styleNumber: style.styleNumber,
        name: style.name,
        division: style.division,
        department: style.department,
        subDepartment: style.subDepartment,
        heroImage: style.images.find((i) => i.isHero)?.url ?? null,
        images: style.images.map((i) => i.url),
        colourways: style.colourways.map((c) => ({
          id: c.id,
          name: c.name,
          images: c.images.map((i) => i.url),
        })),
        variationLevel: style.variationLevel,
        // The SELECTED variation's volume and baselines. Handing a group the
        // style's whole plan is the double-count that inflates vendor spend
        // ~5x through the $20M cap.
        planUnits: selected.planUnits,
        baselineFob: selected.baselineFob,
        baselineLanded: num(style.baselineLanded) === null ? null : selected.baselineLanded,
      },

      /** Every group of this product, for the header dropdown (N2). */
      variations: groups.map((g) => ({
        variationId: g.variationId,
        label: g.label,
        planUnits: g.planUnits,
        allocatedPct: style.awards
          .filter((a) => a.variationKey === variationKeyOf(g.variationId))
          .reduce((sum, a) => sum + (numOr(a.awardPct) ?? 0), 0),
      })),
      selectedVariationId: selected.variationId,

      bids,

      /**
       * The should-cost target itself, not just a direction. Safe here and only
       * here: the vendor route reduces the same numbers to ABOVE/IN_LINE/BELOW
       * so the target cannot be solved backwards.
       */
      cleanSheet: cleanSheetFob
        ? { buckets: cleanSheetBuckets, fob: cleanSheetFob }
        : null,

      // The existing split, so reopening the drawer shows what was saved.
      allocation: style.awards
        .filter((a) => a.variationKey === selectedKey)
        .map((a) => ({
        vendorId: a.vendorId,
        awardPct: numOr(a.awardPct),
        status: a.status,
        comment: a.comment,
      })),

      /**
       * Three reference benchmarks. The domain returns costs with no names —
       * the labels belong to the screen.
       */
      /**
       * The quotation template — sections, line items, labels and units.
       *
       * Returned ONCE, not per bid: every bid on a style belongs to the same
       * RFP and therefore the same template, so per-bid copies would be the
       * same object repeated N times.
       *
       * This is what lets a bucket row expand into the lines behind it with
       * real labels ("Poly Bag", "SAM / SMV [Minutes]") instead of the raw
       * camelCase keys of `values`. The grouping has always existed in the
       * data; the screen was ignoring it.
       */
      template: template
        ? { name: template.name, definition: template.definition }
        : null,

      /**
       * Named allocation rules the buyer can APPLY — they replaced the three
       * display-only scenario lines.
       *
       * The distinction is load-bearing: `scenarios()` returned unit COSTS
       * ("the mean of the three lowest bids"), a price benchmark. A strategy
       * returns a SPLIT, and the savings follow from running that split through
       * `allocate()`. One word apart, completely different arithmetic — see the
       * header of domain/strategies.ts.
       */
      strategies: strategies(
        bids.map((b) => ({
          vendorId: b.vendorId,
          bestCost: b.bestCost,
          cooRegion: b.cooRegion,
          isNewToQuince: b.isNewToQuince,
          isCurrentSupplier: b.isCurrentSupplier,
        })),
        ratio,
      ),
    };
  });
}
