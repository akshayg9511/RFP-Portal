import { db } from "@/lib/db";
import { badRequest, handle, notFound, num } from "@/lib/api";
import { allocate, type VendorAllocation } from "@/domain/award";
import { resolveBestCost } from "@/lib/bestCost";
import { loadRateBook } from "@/lib/rateBook";

/**
 * @openapi
 * /api/styles/{id}/award:
 *   put:
 *     summary: Save the award split for one style
 *     description: >
 *       The browser computes the live readout, but the SERVER decides what is
 *       stored. Best Cost is re-resolved here from the quotes rather than read
 *       from the request, so a stale or edited client payload cannot write a
 *       price nobody quoted.
 *
 *       Rejects anything that does not total exactly 100% — the one hard
 *       validation in the product (Build Doc 11.3), and the origin of the Wave
 *       1 500% bug that required 32 styles to be rebuilt.
 *     responses:
 *       200: { description: The saved allocation }
 *       400: { description: Not 100%, or a vendor with no submitted bid }
 *       404: { description: No such style }
 */
export function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as {
      allocations: { vendorId: string; awardPct: number }[];
      comment?: string | null;
      status?: "ALLOCATED" | "READY_FOR_REVIEW" | "AWARDED";
    };

    if (!Array.isArray(body.allocations)) {
      return badRequest("allocations must be an array");
    }

    const [rates, style] = await Promise.all([
      loadRateBook(),
      db.style.findUnique({
        where: { id },
        include: {
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
                select: {
                  id: true,
                  name: true,
                  cooRegion: true,
                  countryIso: true,
                  isNewToQuince: true,
                },
              },
            },
          },
        },
      }),
    ]);

    if (!style) return notFound(`Style ${id}`);

    const wave = await db.wave.findFirst({ orderBy: { createdAt: "desc" } });
    if (!wave) return badRequest("No wave exists");

    // Drop zero rows before validating: removing a vendor is expressed as 0%,
    // and a 0% award row is not a decision worth storing.
    const requested = body.allocations.filter((a) => a.awardPct > 0);

    const byVendor = new Map(style.quotes.map((q) => [q.vendorId, q]));

    const vendors: VendorAllocation[] = [];
    for (const a of requested) {
      const quote = byVendor.get(a.vendorId);
      if (!quote) {
        return badRequest(
          `Vendor ${a.vendorId} has no submitted bid on this style`,
        );
      }
      const cost = resolveBestCost(quote, style, quote.vendor, rates);
      if (!cost) {
        return badRequest(`Vendor ${a.vendorId} submitted no price`);
      }
      vendors.push({
        vendorId: a.vendorId,
        vendorName: quote.vendor.name,
        cooRegion: quote.vendor.cooRegion,
        awardPct: a.awardPct,
        bestCost: cost.bestCost,
        bestCostBasis: cost.bestCostBasis,
        isNewToQuince: quote.vendor.isNewToQuince,
      });
    }

    const result = allocate({
      styleId: style.id,
      planUnits: style.planUnits ?? 0,
      baselineLanded: num(style.baselineLanded) ?? num(style.baselineFob) ?? 0,
      vendors,
    });

    // Never overridable. Everything else in the product warns; this refuses.
    if (!result.isValid) {
      return badRequest(
        `Award must total exactly 100%. This split totals ${result.allocatedPct}%.`,
      );
    }

    const status = body.status ?? "ALLOCATED";

    /**
     * AWARDING RELEASES THE OUTCOME TO VENDORS.
     *
     * `Invitation.status` has declared AWARDED | NOT_PROCEEDING since the
     * schema was written, and the vendor dashboard has had labels for both —
     * but NOTHING HAS EVER WRITTEN THEM, so a vendor submitted a bid and then
     * heard nothing, forever. This is the write that closes that loop.
     *
     * Only on AWARDED. An allocation is a working decision that can still
     * change; telling a vendor they lost and then reallocating is worse than
     * telling them nothing.
     */
    const invitationUpdates: { id: string; status: string }[] = [];
    if (status === "AWARDED") {
      const winners = new Set(result.lines.map((l) => l.vendorId));

      // Everyone invited to quote THIS product, winners and losers alike. A
      // vendor who bid and lost is owed an answer just as much as one who won.
      const invited = await db.invitation.findMany({
        where: {
          styles: { some: { styleId: style.id } },
          rfp: { status: "ISSUED" },
        },
        select: { id: true, vendorId: true },
      });

      for (const inv of invited) {
        invitationUpdates.push({
          id: inv.id,
          status: winners.has(inv.vendorId) ? "AWARDED" : "NOT_PROCEEDING",
        });
      }
    }

    // Replace wholesale in one transaction: a partial write would leave the
    // style at some total other than 100, which is the state the validation
    // above exists to make impossible.
    await db.$transaction([
      db.award.deleteMany({ where: { waveId: wave.id, styleId: style.id } }),
      db.award.createMany({
        data: result.lines.map((line) => ({
          waveId: wave.id,
          styleId: style.id,
          vendorId: line.vendorId,
          awardPct: line.awardPct,
          bestCost: line.bestCost,
          bestCostBasis: line.bestCostBasis,
          awardedUnits: line.awardedUnits,
          awardedDollars: line.awardedDollars,
          savingsDollars: line.savingsDollars,
          status,
          comment: body.comment?.trim() || null,
          ...(status === "AWARDED"
            ? { awardedAt: new Date(), awardedBy: "Procurement" }
            : {}),
          // Moving BACK from awarded clears the stamp, or a split that was
          // un-awarded still claims an award date.
          ...(status !== "AWARDED" ? { awardedAt: null, awardedBy: null } : {}),
        })),
      }),
      ...invitationUpdates.map((u) =>
        db.invitation.update({
          where: { id: u.id },
          data: { status: u.status },
        }),
      ),
    ]);

    return {
      styleId: style.id,
      vendorsNotified: invitationUpdates.length,
      status,
      allocatedPct: result.allocatedPct,
      totalAwardedDollars: result.totalAwardedDollars,
      totalSavingsDollars: result.totalSavingsDollars,
      savingsPercent: result.savingsPercent,
      lines: result.lines,
    };
  });
}
