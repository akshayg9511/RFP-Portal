import { db } from "@/lib/db";
import { handle, notFound, num } from "@/lib/api";
import { grainGroups, type Grain } from "@/domain/grain";

/**
 * openapi:
 *   /api/styles/{id}/variations:
 *     get:
 *       summary: The bid groups for one product, at its own grain
 *       description: >
 *         Lazy-loaded when a catalog row is expanded. Deliberately NOT folded
 *         into GET /api/styles — that list renders 82 products, and including
 *         variations there would ship every SKU on every catalog render for
 *         the handful of rows a user actually opens.
 *       responses:
 *         200: { description: "{ grain, groups }" }
 *         404: { description: No such style }
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;

    const style = await db.style.findFirst({
      // The catalog has cuids, but a demo URL is easier to type with a style
      // number, and the sibling route already accepts either.
      where: { OR: [{ id }, { styleNumber: id }] },
      select: {
        id: true,
        variationLevel: true,
        planUnits: true,
        retailPrice: true,
        variations: {
          orderBy: [{ sizeSortOrder: "asc" }, { size: "asc" }, { colour: "asc" }],
          select: {
            id: true,
            size: true,
            sizeSortOrder: true,
            colour: true,
            sku: true,
            planUnits: true,
            baselineFob: true,
          },
        },
      },
    });

    if (!style) return notFound("No such style");

    const grain = style.variationLevel as Grain;
    const groups = grainGroups(
      grain,
      style.variations.map((v) => ({
        id: v.id,
        size: v.size,
        sizeSortOrder: v.sizeSortOrder,
        colour: v.colour,
      })),
    );

    const byId = new Map(style.variations.map((v) => [v.id, v]));
    const retail = num(style.retailPrice) ?? 0;

    return {
      styleId: style.id,
      grain,
      groups: groups.map((group) => {
        const members = group.variationIds
          .map((vid) => byId.get(vid))
          .filter((v): v is NonNullable<typeof v> => Boolean(v));

        // Rolled-up figures are SUMMED across the group's members, never
        // averaged — a group's plan units are the units of everything in it.
        const planUnits = members.reduce((t, v) => t + (v.planUnits ?? 0), 0);

        return {
          key: group.key,
          label: group.label,
          variationIds: group.variationIds,
          skuCount: members.length,
          planUnits,
          // Variation carries no retailPrice, so revenue derives from the
          // style's price against the group's own units.
          revenue: planUnits * retail,
          // A group spanning several SKUs has a range, not one cost.
          baselineFobLow: members.length
            ? Math.min(...members.map((v) => num(v.baselineFob) ?? 0))
            : null,
          baselineFobHigh: members.length
            ? Math.max(...members.map((v) => num(v.baselineFob) ?? 0))
            : null,
          skus: members.map((v) => v.sku).filter(Boolean),
        };
      }),
    };
  });
}
