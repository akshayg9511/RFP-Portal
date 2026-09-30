import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";
import { savingsPotential, styleStatus } from "@/domain/award";
import { resolveBestCost } from "@/lib/bestCost";
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
          quotes: {
            where: { status: "SUBMITTED" },
            select: {
              fob: true,
              vendorId: true,
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

        // The real chain, per bid. A quote with no FOB resolves to null and is
        // dropped rather than counted as free.
        const bids = style.quotes
          .map((q) => {
            const cost = resolveBestCost(q, style, q.vendor, rates);
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

        const bestCosts = bids.map((b) => b.bestCost);

        const status = styleStatus(
          style.awards.map((a) => ({
            awardPct: numOr(a.awardPct),
            status: a.status,
          })),
        );

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
          bestAvailableCost: bestCosts.length ? Math.min(...bestCosts) : null,
          bestAvailableBasis: bestCosts.length
            ? bids.reduce((lo, b) => (b.bestCost < lo.bestCost ? b : lo)).bestCostBasis
            : null,
          // The ceiling: lowest Best Cost at 100% against baseline, annualised.
          savingsPotential: savingsPotential(planUnits, baselineLanded, bestCosts),

          status,
          allocation: style.awards.map((a) => ({
            vendorId: a.vendor.id,
            vendorName: a.vendor.name,
            cooRegion: a.vendor.cooRegion,
            awardPct: numOr(a.awardPct),
            bestCost: num(a.bestCost),
            // Two vendors' Best Cost can differ in KIND, and min() picks between
            // them silently — the basis has to travel with the number.
            bestCostBasis: a.bestCostBasis,
            awardedDollars: num(a.awardedDollars),
            savingsDollars: num(a.savingsDollars),
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
