import { db } from "@/lib/db";
import { badRequest, handle } from "@/lib/api";
import { variationKeyOf } from "@/domain/grain";

/**
 * @openapi
 * /api/styles/{id}/freight-split:
 *   put:
 *     summary: The air / ocean split for one product x variant (P5)
 *     description: >
 *       Applies to every vendor on that variant, so its bids are always
 *       compared on one freight assumption. `airPct` 0-100; ocean is the rest.
 *       `airPct: null` resets to the wave default (70 / 30).
 */
export function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const body = (await request.json()) as {
      variationId?: string | null;
      airPct: number | null;
    };
    const variationKey = variationKeyOf(body.variationId ?? null);

    if (body.airPct === null) {
      await db.variantFreight.deleteMany({ where: { styleId: id, variationKey } });
      return { ok: true, airPct: null };
    }
    if (typeof body.airPct !== "number" || !Number.isFinite(body.airPct) || body.airPct < 0 || body.airPct > 100) {
      return badRequest("airPct must be between 0 and 100");
    }
    const airPct = Math.round(body.airPct * 100) / 100;
    await db.variantFreight.upsert({
      where: { styleId_variationKey: { styleId: id, variationKey } },
      create: { styleId: id, variationKey, airPct },
      update: { airPct },
    });
    return { ok: true, airPct };
  });
}
