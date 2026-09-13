import { db } from "@/lib/db";
import { badRequest, ok } from "@/lib/api";

/**
 * @openapi
 * /api/rfps/{id}/invitations:
 *   put:
 *     summary: Set which vendors are nominated, and each one's product subset
 *     description: >
 *       Idempotent. Send the full desired set; vendors absent from it are
 *       removed. Each vendor's subset defaults to every product in the RFP and
 *       is fully adjustable — vendor A may get products 1-4, vendor C only 1-3.
 *     responses:
 *       200: { description: The resulting invitations }
 *       400: { description: A vendor already bids on one of these products }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    invitations?: { vendorId: string; styleIds: string[] }[];
  };
  const wanted = body.invitations ?? [];

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      include: { styles: { select: { styleId: true } } },
    });
    if (!rfp) return badRequest("No such RFP");

    // An invitation cannot carry a product the RFP does not contain.
    const inScope = new Set(rfp.styles.map((s) => s.styleId));
    for (const inv of wanted) {
      if (!inv.styleIds.length) {
        return badRequest("Every nominated vendor needs at least one product");
      }
      if (inv.styleIds.some((sid) => !inScope.has(sid))) {
        return badRequest("A product outside this RFP was assigned to a vendor");
      }
    }

    // Build Doc §5.3: one product may appear in only one RFP per vendor at a
    // time. Checked on the server, because the screen's copy of the world can
    // be stale by the time it posts.
    for (const inv of wanted) {
      const conflict = await db.invitation.findFirst({
        where: {
          rfpId: { not: id },
          vendorId: inv.vendorId,
          styles: { some: { styleId: { in: inv.styleIds } } },
        },
        include: {
          rfp: { select: { name: true } },
          vendor: { select: { name: true } },
        },
      });
      if (conflict) {
        return badRequest(
          `${conflict.vendor.name} already bids on one of these products in "${conflict.rfp.name}"`,
        );
      }
    }

    const existing = await db.invitation.findMany({ where: { rfpId: id } });
    const wantedIds = new Set(wanted.map((w) => w.vendorId));

    // Remove vendors no longer nominated. An ISSUED invitation is not silently
    // withdrawn — the screen only sends removals for draft RFPs.
    for (const inv of existing) {
      if (!wantedIds.has(inv.vendorId)) {
        await db.invitation.delete({ where: { id: inv.id } });
      }
    }

    for (const inv of wanted) {
      const invitation = await db.invitation.upsert({
        where: { rfpId_vendorId: { rfpId: id, vendorId: inv.vendorId } },
        create: { rfpId: id, vendorId: inv.vendorId, status: "NOT_STARTED" },
        update: {},
      });

      // Reset the subset to exactly what was sent.
      await db.invitationStyle.deleteMany({
        where: { invitationId: invitation.id },
      });
      await db.invitationStyle.createMany({
        data: inv.styleIds.map((styleId) => ({
          invitationId: invitation.id,
          styleId,
        })),
      });
    }

    const result = await db.invitation.findMany({
      where: { rfpId: id },
      include: {
        vendor: { select: { name: true } },
        styles: { select: { styleId: true } },
      },
    });

    return ok({
      invitations: result.map((i) => ({
        id: i.id,
        vendorId: i.vendorId,
        vendorName: i.vendor.name,
        styleIds: i.styles.map((s) => s.styleId),
      })),
    });
  } catch (error) {
    console.error("[api/rfps/[id]/invitations]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
