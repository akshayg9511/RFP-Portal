import { db } from "@/lib/db";
import { handle, num, numOr } from "@/lib/api";

/**
 * @openapi
 * /api/vendor/{vendorId}/invitations:
 *   get:
 *     summary: A vendor's dashboard — the RFPs they have been asked to quote
 *     description: >
 *       Scoped to one vendor. In the prototype the id comes from the Vendor
 *       View switcher; in V1 it comes from the session. Nothing else about
 *       this endpoint changes.
 *
 *       Returns only ISSUED RFPs: a draft is not visible to the vendor it has
 *       not been sent to.
 *     responses:
 *       200: { description: Invitations with completion }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vendorId: string }> },
) {
  const { vendorId } = await params;

  return handle(async () => {
    const invitations = await db.invitation.findMany({
      where: { vendorId, rfp: { status: "ISSUED" } },
      include: {
        rfp: {
          include: {
            template: { select: { name: true } },
            wave: { select: { name: true } },
          },
        },
        styles: {
          include: {
            style: {
              select: {
                id: true,
                styleNumber: true,
                name: true,
                images: {
                  where: { isHero: true },
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
        quotes: {
          select: { styleId: true, status: true, fob: true },
        },
      },
      orderBy: { issuedAt: "desc" },
    });

    /**
     * THE VENDOR'S OWN AWARD OUTCOME — and only their own.
     *
     * Same boundary as the competitiveness signal: their share and their
     * volume cross, nothing else does. No rival's price, no other vendor's
     * name, no wave total, no indication of how many vendors the product was
     * split across. A vendor learns what they won, never what they lost to.
     *
     * Released only when procurement marks the style AWARDED — an ALLOCATED
     * row is a working decision that can still change.
     */
    const releasedAwards = await db.award.findMany({
      where: { vendorId, status: "AWARDED" },
      select: {
        styleId: true,
        awardPct: true,
        awardedUnits: true,
      },
    });
    const awardByStyle = new Map(releasedAwards.map((a) => [a.styleId, a]));

    // Which styles have been awarded AT ALL — a style awarded to someone else
    // is how a vendor learns they are not proceeding. Only the fact, never who.
    const decidedStyleIds = new Set(
      (
        await db.award.findMany({
          where: {
            status: "AWARDED",
            styleId: {
              in: invitations.flatMap((i) => i.styles.map((s) => s.styleId)),
            },
          },
          select: { styleId: true },
        })
      ).map((a) => a.styleId),
    );

    return invitations.map((inv) => {
      const submitted = new Set(
        inv.quotes.filter((q) => q.status === "SUBMITTED").map((q) => q.styleId),
      );
      const drafted = new Set(
        inv.quotes.filter((q) => q.status === "DRAFT").map((q) => q.styleId),
      );
      const total = inv.styles.length;

      return {
        id: inv.id,
        status: inv.status,
        currentRound: inv.currentRound,
        rfp: {
          id: inv.rfp.id,
          name: inv.rfp.name,
          instructions: inv.rfp.instructions,
          dueDate: inv.rfp.dueDate,
          templateName: inv.rfp.template.name,
          waveName: inv.rfp.wave.name,
          sourcingPartner: inv.rfp.sourcingPartner,
          gm: inv.rfp.gm,
        },
        productCount: total,
        submittedCount: submitted.size,
        // Completion is what the vendor sees on their dashboard.
        completion: total ? submitted.size / total : 0,
        // How many of this RFP's products they won, once released.
        awardedCount: inv.styles.filter((is) => awardByStyle.has(is.styleId))
          .length,
        decidedCount: inv.styles.filter((is) => decidedStyleIds.has(is.styleId))
          .length,
        products: inv.styles.map((is) => {
          const won = awardByStyle.get(is.styleId);
          const decided = decidedStyleIds.has(is.styleId);

          return {
            id: is.style.id,
            styleNumber: is.style.styleNumber,
            name: is.style.name,
            heroImage: is.style.images[0]?.url ?? null,
            cannotBid: is.cannotBid,
            state: submitted.has(is.styleId)
              ? "SUBMITTED"
              : drafted.has(is.styleId)
                ? "DRAFT"
                : "BLANK",
            fob: num(
              inv.quotes.find((q) => q.styleId === is.styleId)?.fob ?? null,
            ),

            // THEIR outcome. `null` while undecided — silence is honest; a
            // premature "not proceeding" would be a lie.
            outcome: won ? "AWARDED" : decided ? "NOT_PROCEEDING" : null,
            // Their share and their volume. Nothing about anyone else — a
            // vendor cannot tell from this whether the product was split.
            awardPct: won ? numOr(won.awardPct) : null,
            awardedUnits: won?.awardedUnits ?? null,
          };
        }),
      };
    });
  });
}
