import { db } from "@/lib/db";
import { handle, num } from "@/lib/api";

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
        products: inv.styles.map((is) => ({
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
        })),
      };
    });
  });
}
