import { db } from "@/lib/db";
import { badRequest, handle, notFound } from "@/lib/api";
import { variationKeyOf } from "@/domain/grain";

/**
 * @openapi
 * /api/bids/{invitationId}/{styleId}/freight:
 *   put:
 *     summary: Quince's freight decision for one bid (P3)
 *     description: >
 *       `basis` null = automatic (the cheaper blend); QUINCE_BLEND or
 *       DDP_BLEND = override. Per bid — one vendor x product x VARIANT —
 *       because it is a decision about that vendor's quote on that size.
 *       Internal only: never shown to the vendor.
 */
export function PUT(
  request: Request,
  { params }: { params: Promise<{ invitationId: string; styleId: string }> },
) {
  return handle(async () => {
    const { invitationId, styleId } = await params;
    const body = (await request.json()) as {
      variationId?: string | null;
      basis: "QUINCE_BLEND" | "DDP_BLEND" | null;
    };
    if (body.basis !== null && body.basis !== "QUINCE_BLEND" && body.basis !== "DDP_BLEND") {
      return badRequest("basis must be null, QUINCE_BLEND or DDP_BLEND");
    }
    const quote = await db.quote.findFirst({
      where: { invitationId, styleId, variationKey: variationKeyOf(body.variationId ?? null) },
      select: { id: true, ddpWest: true, ddpWestAir: true, ddpEast: true, ddpEastAir: true },
    });
    if (!quote) return notFound("No quote for that bid");

    // Choosing DDP needs a DDP quote in BOTH modes (decided 5 Oct). Refuse
    // rather than store an override computeCost would silently ignore.
    if (body.basis === "DDP_BLEND") {
      const hasOcean = quote.ddpWest !== null || quote.ddpEast !== null;
      const hasAir = quote.ddpWestAir !== null || quote.ddpEastAir !== null;
      if (!hasOcean || !hasAir) {
        return badRequest("This vendor did not quote DDP for both air and ocean");
      }
    }

    await db.quote.update({ where: { id: quote.id }, data: { freightBasis: body.basis } });
    return { ok: true, basis: body.basis };
  });
}
