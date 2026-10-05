import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";
import { savingsPotential, styleStatus } from "@/domain/award";
import { resolveBestCost } from "@/lib/bestCost";
import { awardGroups, FREIGHT_SPLIT_SELECT, VARIATION_SELECT } from "@/lib/variationGroups";
import { loadRateBook } from "@/lib/rateBook";

/**
 * @openapi
 * /api/award-summary:
 *   get:
 *     summary: One row per style with its allocation state
 *     description: >
 *       The entry point to award. Sortable by savings potential, which is what
 *       makes it possible to find where the money actually is.
 *
 *       Ranking runs on BEST COST — the full chain of FOB, tariff, logistics,
 *       landed and the 70/30 blend, resolved through lib/bestCost. It used to
 *       approximate with raw FOB, which overstated savings and compared an FOB
 *       against a landed baseline: the Wave 1 -$37,038 error in mirror image.
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [UNTOUCHED, ALLOCATED, READY_FOR_REVIEW, AWARDED]
 *       - name: cooRegion
 *         in: query
 *         schema: { type: string }
 *       - name: division
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: Style rows, highest savings potential first }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const regionFilter = url.searchParams.get("cooRegion");
  const divisionFilter = url.searchParams.get("division");

  return handle(async () => {
    // Rates once for the whole request, not once per bid — 82 styles times
    // several bids each is otherwise an N+1 on two tables.
    const [rates, styles] = await Promise.all([
      loadRateBook(),
      db.style.findMany({
        include: {
          images: {
            where: { isHero: true },
            orderBy: { position: "asc" },
            take: 1,
            select: { url: true },
          },
          variations: VARIATION_SELECT,
          freightSplits: FREIGHT_SPLIT_SELECT,
          quotes: {
            where: { status: "SUBMITTED" },
            select: {
              freightBasis: true,
              fob: true,
              vendorId: true,
              variationKey: true,
              ddpWest: true,
              ddpCentral: true,
              ddpEast: true,
              ddpWestAir: true,
              ddpCentralAir: true,
              ddpEastAir: true,
              vendor: {
                select: { name: true, cooRegion: true, countryIso: true },
              },
            },
          },
          awards: {
            select: {
              variationKey: true,
              awardedUnits: true,
              awardPct: true,
              status: true,
              awardedDollars: true,
              savingsDollars: true,
              bestCost: true,
              bestCostBasis: true,
              vendor: { select: { id: true, name: true, cooRegion: true } },
            },
          },
        },
      }),
    ]);

    const rows = styles
      .map((style) => {
        const baselineFob = num(style.baselineFob) ?? 0;
        // Savings compare LANDED against LANDED. bestCost carries tariff and
        // freight, so measuring it against an FOB baseline turns every real
        // saving into an apparent increase — which is how this screen first
        // reported -$8.29M. Falls back to FOB only where no landed baseline
        // exists, which the seed gate does not currently allow.
        const baselineLanded = num(style.baselineLanded) ?? baselineFob;
        const planUnits = style.planUnits ?? 0;

        /**
         * PER VARIATION, then rolled up — decision N6, 5 Oct.
         *
         * Quotes and awards are per variation now. Read flat, a 5-size
         * product counted each vendor five times in `bidCount`, listed each
         * winner five times in `allocation` (which also made the by-vendor
         * view count five "products"), and took the CHEAPEST size's bid as
         * the product's best cost — then multiplied it by the WHOLE product's
         * volume for the savings ceiling. Each group is computed on its own
         * bids, volume and baseline, and only then summed.
         *
         * A STYLE-grained product is one group, so it is unchanged.
         */
        const groups = awardGroups(style, rates.blend);
        const groupRows = groups.map((group) => {
          // The real chain, per bid. A quote with no FOB resolves to null and
          // is dropped rather than counted as free.
          const bids = style.quotes
            .filter((q) => q.variationKey === group.variationKey)
            .map((q) => {
              const cost = resolveBestCost(q, style, q.vendor, rates, group.size, group.blend);
              return cost
                ? {
                    vendorId: q.vendorId,
                    vendorName: q.vendor.name,
                    cooRegion: q.vendor.cooRegion,
                    fob: num(q.fob),
                    bestCost: cost.bestCost,
                    bestCostBasis: cost.bestCostBasis,
                  }
                : null;
            })
            .filter((b): b is NonNullable<typeof b> => b !== null);
          const costs = bids.map((b) => b.bestCost);
          const awards = style.awards.filter(
            (a) => a.variationKey === group.variationKey,
          );
          const allocatedPct = awards.reduce((t, a) => t + numOr(a.awardPct), 0);
          return {
            group,
            bids,
            lowest: costs.length ? Math.min(...costs) : null,
            lowestBasis: costs.length
              ? bids.reduce((lo, b) => (b.bestCost < lo.bestCost ? b : lo)).bestCostBasis
              : null,
            savingsPotential: savingsPotential(
              group.planUnits,
              group.baselineLanded,
              costs,
            ),
            awards,
            allocatedPct,
            allocated: Math.abs(allocatedPct - 100) < 0.005,
          };
        });

        // Distinct vendors across every variation — a vendor bidding five
        // sizes is ONE bidder on this product.
        const bidderMap = new Map<
          string,
          { vendorId: string; vendorName: string; cooRegion: string | null; bestCost: number }
        >();
        for (const g of groupRows) {
          for (const b of g.bids) {
            const cur = bidderMap.get(b.vendorId);
            if (!cur || b.bestCost < cur.bestCost) {
              bidderMap.set(b.vendorId, {
                vendorId: b.vendorId,
                vendorName: b.vendorName,
                cooRegion: b.cooRegion,
                bestCost: b.bestCost,
              });
            }
          }
        }
        const bids = [...bidderMap.values()];

        /**
         * The product's best available cost, UNITS-WEIGHTED across its
         * variations' own lowest bids. Not the single cheapest size — Twin's
         * price is not what Queen costs.
         */
        const pricedGroups = groupRows.filter((g) => g.lowest !== null);
        const pricedUnits = pricedGroups.reduce((t, g) => t + g.group.planUnits, 0);
        const bestAvailableCost = pricedGroups.length
          ? pricedUnits
            ? pricedGroups.reduce((t, g) => t + g.lowest! * g.group.planUnits, 0) /
              pricedUnits
            : pricedGroups[0]!.lowest
          : null;

        const status = styleStatus(
          style.awards.map((a) => ({
            awardPct: numOr(a.awardPct),
            status: a.status,
          })),
        );

        /**
         * One allocation entry PER VENDOR for the product row. Dollars sum
         * across variations; the percentage is the vendor's share of the
         * product's AWARDED UNITS, which is what "Coimbatore has 60% of this
         * product" means once sizes can be split differently.
         */
        const totalAwardedUnits = style.awards.reduce(
          (t, a) => t + (a.awardedUnits ?? 0),
          0,
        );
        const byVendor = new Map<
          string,
          {
            vendorId: string;
            vendorName: string;
            cooRegion: string | null;
            units: number;
            awardedDollars: number;
            savingsDollars: number;
            bestCostBasis: string | null;
          }
        >();
        for (const a of style.awards) {
          const cur = byVendor.get(a.vendor.id) ?? {
            vendorId: a.vendor.id,
            vendorName: a.vendor.name,
            cooRegion: a.vendor.cooRegion,
            units: 0,
            awardedDollars: 0,
            savingsDollars: 0,
            bestCostBasis: a.bestCostBasis,
          };
          cur.units += a.awardedUnits ?? 0;
          cur.awardedDollars += numOr(a.awardedDollars);
          cur.savingsDollars += numOr(a.savingsDollars);
          byVendor.set(a.vendor.id, cur);
        }

        return {
          id: style.id,
          styleNumber: style.styleNumber,
          name: style.name,
          division: style.division,
          department: style.department,
          subDepartment: style.subDepartment,
          // A8 filters on material. It has always been on Style and was simply
          // not selected here.
          material: style.material,
          heroImage: style.images[0]?.url ?? null,

          planUnits,
          baselineFob,
          baselineLanded,

          bidCount: bids.length,
          variationCount: groups.length,
          allocatedVariations: groupRows.filter((g) => g.allocated).length,
          /** One row per variation, for the chevron (N6). */
          variations:
            groups.length > 1
              ? groupRows.map((g) => ({
                  variationId: g.group.variationId,
                  label: g.group.label,
                  planUnits: g.group.planUnits,
                  bidCount: g.bids.length,
                  bestAvailableCost: g.lowest,
                  savingsPotential: g.savingsPotential,
                  allocatedPct: g.allocatedPct,
                  status: g.awards[0]?.status ?? "UNTOUCHED",
                  awardedDollars: g.awards.reduce((t, a) => t + numOr(a.awardedDollars), 0),
                  savingsDollars: g.awards.reduce((t, a) => t + numOr(a.savingsDollars), 0),
                  allocation: g.awards.map((a) => ({
                    vendorId: a.vendor.id,
                    vendorName: a.vendor.name,
                    awardPct: numOr(a.awardPct),
                  })),
                }))
              : [],
          /**
           * EVERY vendor that bid, with their region — not just the ones that
           * won an allocation.
           *
           * This was computed above and discarded. Because of that, the region
           * filter could only read `allocation[].cooRegion`, so an unallocated
           * style had no region at all and vanished from a region filter —
           * exactly the styles someone filtering by region wants to find.
           */
          bidders: bids.map((b) => ({
            vendorId: b.vendorId,
            vendorName: b.vendorName,
            cooRegion: b.cooRegion,
            bestCost: b.bestCost,
          })),
          /**
           * The lowest LANDED Best Cost available on this style. Named for what
           * it is — the previous `lowestBidFob` was an FOB being read as though
           * it were comparable with a landed baseline.
           */
          bestAvailableCost,
          bestAvailableBasis: pricedGroups[0]?.lowestBasis ?? null,
          // The ceiling, summed PER VARIATION: each size's lowest bid against
          // that size's own baseline and volume.
          savingsPotential: groupRows.reduce((t, g) => t + g.savingsPotential, 0),

          status,
          allocation: [...byVendor.values()].map((v) => ({
            vendorId: v.vendorId,
            vendorName: v.vendorName,
            cooRegion: v.cooRegion,
            awardPct: totalAwardedUnits
              ? Math.round((v.units / totalAwardedUnits) * 1000) / 10
              : 0,
            bestCost: v.units ? v.awardedDollars / v.units : null,
            bestCostBasis: v.bestCostBasis,
            awardedDollars: v.awardedDollars,
            savingsDollars: v.savingsDollars,
          })),
          awardedDollars: style.awards.reduce(
            (s, a) => s + numOr(a.awardedDollars),
            0,
          ),
          savingsDollars: style.awards.reduce(
            (s, a) => s + numOr(a.savingsDollars),
            0,
          ),
        };
      })
      .filter((row) => {
        if (statusFilter && row.status !== statusFilter) return false;
        if (divisionFilter && row.division !== divisionFilter) return false;
        // NOTE: region filters on the ALLOCATION, so an unallocated style is
        // excluded — it has no region yet. The screen says so on the chip.
        if (
          regionFilter &&
          !row.allocation.some((a) => a.cooRegion === regionFilter)
        ) {
          return false;
        }
        return true;
      });

    return rows.sort((a, b) => b.savingsPotential - a.savingsPotential);
  });
}
