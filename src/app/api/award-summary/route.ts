import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";
import { savingsPotential, styleStatus } from "@/domain/award";

/**
 * @openapi
 * /api/award-summary:
 *   get:
 *     summary: One row per style with its allocation state
 *     description: >
 *       The entry point to award. Sortable by savings potential, which is what
 *       makes it possible to find where the money actually is.
 *     parameters:
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [UNTOUCHED, ALLOCATED, READY_FOR_REVIEW, AWARDED]
 *       - name: cooRegion
 *         in: query
 *         schema: { type: string }
 *     responses:
 *       200: { description: Style rows, highest savings potential first }
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get("status");
  const regionFilter = url.searchParams.get("cooRegion");

  return handle(async () => {
    const styles = await db.style.findMany({
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
            vendor: { select: { name: true, cooRegion: true } },
          },
        },
        awards: {
          select: {
            awardPct: true,
            status: true,
            awardedDollars: true,
            savingsDollars: true,
            bestCost: true,
            vendor: { select: { id: true, name: true, cooRegion: true } },
          },
        },
      },
    });

    const rows = styles
      .map((style) => {
        const baselineFob = num(style.baselineFob) ?? 0;
        const planUnits = style.planUnits ?? 0;

        // Best Cost per bid. The quote stores FOB; Best Cost is computed in the
        // playground from the full chain, so here we approximate ranking by FOB
        // and expose the stored award Best Cost where one exists.
        const bidFobs = style.quotes
          .map((q) => num(q.fob))
          .filter((f): f is number => f !== null);

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
          heroImage: style.images[0]?.url ?? null,

          planUnits,
          baselineFob,

          bidCount: style.quotes.length,
          lowestBidFob: bidFobs.length ? Math.min(...bidFobs) : null,
          // The ceiling: lowest Best Cost at 100% against baseline FOB annual.
          savingsPotential: savingsPotential(planUnits, baselineFob, bidFobs),

          status,
          allocation: style.awards.map((a) => ({
            vendorId: a.vendor.id,
            vendorName: a.vendor.name,
            cooRegion: a.vendor.cooRegion,
            awardPct: numOr(a.awardPct),
            bestCost: num(a.bestCost),
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
