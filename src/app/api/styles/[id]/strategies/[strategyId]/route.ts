import { db } from "@/lib/db";
import { handle, notFound, ok } from "@/lib/api";

/**
 * @openapi
 * /api/styles/{id}/strategies/{strategyId}:
 *   delete:
 *     summary: Forget a named strategy
 *     description: >
 *       Deleting a strategy never touches the committed allocation — a strategy
 *       is a candidate, and Award owns what was actually committed. So this is
 *       safe even for the strategy currently filling the inputs.
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: No such strategy on this style }
 */
export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; strategyId: string }> },
) {
  return handle(async () => {
    const { id, strategyId } = await params;

    // Scoped by styleId as well as id, so a strategy id from another product
    // cannot be deleted through this product's URL.
    const existing = await db.awardStrategy.findFirst({
      where: { id: strategyId, styleId: id },
      select: { id: true, name: true },
    });
    if (!existing) return notFound(`Strategy ${strategyId}`);

    await db.awardStrategy.delete({ where: { id: existing.id } });
    return ok({ id: existing.id, name: existing.name, deleted: true });
  });
}
