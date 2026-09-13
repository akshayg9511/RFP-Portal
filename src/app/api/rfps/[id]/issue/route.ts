import { db } from "@/lib/db";
import { badRequest, ok } from "@/lib/api";

/**
 * @openapi
 * /api/rfps/{id}/issue:
 *   post:
 *     summary: Issue the RFP to its nominated vendors
 *     description: >
 *       DRAFT -> ISSUED. Every invitation becomes visible in that vendor's
 *       dashboard, reachable immediately through Vendor View. The prototype
 *       sends no email — there is no vendor login, so issuing IS the delivery.
 *     responses:
 *       200: { description: Issue summary }
 *       400: { description: Not ready to issue }
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const rfp = await db.rfp.findUnique({
      where: { id },
      include: {
        invitations: { include: { vendor: { select: { name: true } } } },
        styles: { select: { styleId: true } },
      },
    });

    if (!rfp) return badRequest("No such RFP");
    if (!rfp.name?.trim()) {
      return badRequest("The RFP needs a name before it can be issued");
    }
    if (!rfp.invitations.length) {
      return badRequest("Nominate at least one vendor before issuing");
    }
    if (rfp.status === "ISSUED") {
      return badRequest("This RFP has already been issued");
    }

    const issuedAt = new Date();

    await db.rfp.update({
      where: { id },
      data: { status: "ISSUED", issuedAt },
    });

    await db.invitation.updateMany({
      where: { rfpId: id },
      data: { status: "NOT_STARTED", issuedAt },
    });

    await db.activityLog.create({
      data: {
        entity: "RFP",
        entityId: id,
        action: "ISSUED",
        actorSide: "QUINCE",
        detail: {
          vendorCount: rfp.invitations.length,
          styleCount: rfp.styles.length,
        } as never,
      },
    });

    return ok({
      id,
      status: "ISSUED",
      issuedAt,
      vendorCount: rfp.invitations.length,
      styleCount: rfp.styles.length,
      vendors: rfp.invitations.map((i) => i.vendor.name),
    });
  } catch (error) {
    console.error("[api/rfps/[id]/issue]", error);
    return Response.json(
      { error: "server_error", message: String(error) },
      { status: 500 },
    );
  }
}
