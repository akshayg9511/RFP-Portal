import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";

/**
 * @openapi
 * /api/vendors/{vendorId}/awards:
 *   get:
 *     summary: Everything one vendor won in this wave, with the full cost chain
 *     description: >
 *       PROCUREMENT'S VIEW — internal. Award Summary answers "what happened to
 *       this product"; this answers "what did we give this vendor", which is
 *       the question a guardrail breach actually raises.
 *
 *       Carries the per-destination DDP grid. Everywhere else that grid is
 *       collapsed into a single blended figure, which is right for comparison
 *       but leaves no way to see WHY a Best Cost was picked on the DDP side.
 *       Here the reasoning has to be inspectable.
 *     responses:
 *       200: { description: Awarded products with award %, dollars and costs }
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  return handle(async () => {
    const { vendorId } = await params;

    const awards = await db.award.findMany({
      where: { vendorId },
      include: {
        style: {
          select: {
            id: true,
            styleNumber: true,
            name: true,
            planUnits: true,
            baselineFob: true,
            baselineLanded: true,
            images: {
              where: { isHero: true },
              orderBy: { position: "asc" },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
      orderBy: { awardedDollars: "desc" },
    });

    // Their own submitted quote per style — the FOB and the DDP grid behind
    // the Best Cost stored on the award row.
    const quotes = await db.quote.findMany({
      where: {
        vendorId,
        status: "SUBMITTED",
        styleId: { in: awards.map((a) => a.styleId) },
      },
      select: {
        styleId: true,
        fob: true,
        dutyType: true,
        ddpWest: true,
        ddpCentral: true,
        ddpEast: true,
        ddpWestAir: true,
        ddpCentralAir: true,
        ddpEastAir: true,
      },
    });
    const quoteByStyle = new Map(quotes.map((q) => [q.styleId, q]));

    const rows = awards.map((a) => {
      const q = quoteByStyle.get(a.styleId);
      return {
        styleId: a.styleId,
        styleNumber: a.style.styleNumber,
        styleName: a.style.name,
        heroImage: a.style.images[0]?.url ?? null,
        planUnits: a.style.planUnits ?? 0,

        awardPct: numOr(a.awardPct),
        awardedUnits: a.awardedUnits ?? 0,
        awardedDollars: numOr(a.awardedDollars),
        savingsDollars: numOr(a.savingsDollars),
        status: a.status,

        baselineFob: num(a.style.baselineFob),
        baselineLanded: num(a.style.baselineLanded),

        fob: q ? num(q.fob) : null,
        bestCost: num(a.bestCost),
        bestCostBasis: a.bestCostBasis,
        dutyType: q?.dutyType ?? null,

        // The grid, uncollapsed. The unsuffixed trio is the OCEAN set.
        //
        // Null when the vendor quoted no DDP at all — a QDDP vendor (Quince
        // arranges freight) correctly has none, and rendering an empty grid of
        // dashes implies missing data rather than a deliberate incoterm.
        ddp:
          q &&
          [q.ddpWest, q.ddpCentral, q.ddpEast, q.ddpWestAir, q.ddpCentralAir, q.ddpEastAir].some(
            (v) => v !== null,
          )
          ? {
              ocean: {
                west: num(q.ddpWest),
                central: num(q.ddpCentral),
                east: num(q.ddpEast),
              },
              air: {
                west: num(q.ddpWestAir),
                central: num(q.ddpCentralAir),
                east: num(q.ddpEastAir),
              },
            }
          : null,
      };
    });

    return {
      totals: {
        products: rows.length,
        awardedDollars: rows.reduce((s, r) => s + r.awardedDollars, 0),
        awardedUnits: rows.reduce((s, r) => s + r.awardedUnits, 0),
        savingsDollars: rows.reduce((s, r) => s + r.savingsDollars, 0),
      },
      awards: rows,
    };
  });
}
